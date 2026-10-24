import { XMLParser } from 'fast-xml-parser';
import logger from './logger.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true
});

const DEFAULT_UPNP_PORT = 9197;
const DEFAULT_CONTROL_PATH = '/upnp/control/RenderingControl1';
const SERVICE_TYPE = 'urn:schemas-upnp-org:service:RenderingControl:1';
const DEFAULT_TIMEOUT_MS = 3000; // Strict 3000ms timeout for snappy responsiveness

/**
 * Builds standard UPnP SOAP Envelope
 */
function buildSoapEnvelope(actionName, bodyXml) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${actionName} xmlns:u="${SERVICE_TYPE}">
      ${bodyXml}
    </u:${actionName}>
  </s:Body>
</s:Envelope>`;
}

/**
 * Performs a SOAP POST request to the UPnP endpoint with guaranteed timeout
 */
async function sendSoapRequest(ip, port, controlPath, actionName, bodyXml, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const cleanIp = String(ip).replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  const url = `http://${cleanIp}:${port}${controlPath.startsWith('/') ? controlPath : '/' + controlPath}`;
  const soapPayload = buildSoapEnvelope(actionName, bodyXml);
  const soapActionHeader = `"${SERVICE_TYPE}#${actionName}"`;

  const startTime = Date.now();
  logger.soap(`SOAP -> ${actionName} to ${url} (Timeout: ${timeoutMs}ms)`, {
    action: actionName,
    url,
    payloadSnippet: soapPayload.replace(/\s+/g, ' ').slice(0, 150)
  });

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`SOAP request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPAction': soapActionHeader,
        'User-Agent': 'SamsungTizenTool/1.0 DLNADOC/1.50'
      },
      body: soapPayload,
      signal: controller.signal
    });

    clearTimeout(timer);
    const duration = Date.now() - startTime;
    const responseText = await res.text();

    logger.soap(`SOAP <- ${actionName} response [${res.status} ${res.statusText}] (${duration}ms)`, {
      status: res.status,
      durationMs: duration,
      responseSnippet: responseText.replace(/\s+/g, ' ').slice(0, 200)
    });

    if (!res.ok) {
      throw new Error(`SOAP HTTP Error ${res.status}: ${res.statusText} - ${responseText.slice(0, 150)}`);
    }

    return {
      status: res.status,
      xml: responseText,
      duration
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError' || err.message.includes('timeout') || err.message.includes('aborted');
    const errMsg = isTimeout
      ? `SOAP call ${actionName} timed out after ${timeoutMs}ms (TV Port ${port} did not respond)`
      : `SOAP call ${actionName} failed on ${url}: ${err.message}`;

    logger.error('SOAP', errMsg);
    const error = new Error(errMsg);
    error.isTimeout = isTimeout;
    throw error;
  }
}

/**
 * Extracts numeric value from XML via regex or fast-xml-parser
 */
function extractTagValue(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]+)<\/${tagName}>`, 'i');
  const match = xml.match(regex);
  if (match) return match[1];

  try {
    const parsed = xmlParser.parse(xml);
    function search(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (tagName in obj) return obj[tagName];
      for (const key of Object.keys(obj)) {
        const res = search(obj[key]);
        if (res !== null) return res;
      }
      return null;
    }
    return search(parsed);
  } catch {
    return null;
  }
}

export class UpnpVolumeClient {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_UPNP_PORT;
    this.controlPath = options.controlPath || DEFAULT_CONTROL_PATH;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  /**
   * Discovers the exact RenderingControl controlURL from the TV's device description XML
   */
  async resolveControlPath(ip, preferredPort = this.port) {
    const cleanIp = String(ip).replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    const candidateUrls = [
      `http://${cleanIp}:${preferredPort}/dmr/SamsungMRDesc.xml`,
      `http://${cleanIp}:${preferredPort}/upnp/device.xml`,
      `http://${cleanIp}:7676/smp_2_`,
      `http://${cleanIp}:7676/dmr/SamsungMRDesc.xml`
    ];

    for (const descUrl of candidateUrls) {
      try {
        const res = await fetch(descUrl, { signal: AbortSignal.timeout(1200) });
        if (res.ok) {
          const xml = await res.text();
          if (xml.includes('RenderingControl:1') || xml.includes('RenderingControl')) {
            const parsed = xmlParser.parse(xml);
            let foundControlUrl = null;
            function findService(obj) {
              if (!obj || typeof obj !== 'object') return;
              if (obj.serviceType && String(obj.serviceType).includes('RenderingControl:1')) {
                foundControlUrl = obj.controlURL;
                return;
              }
              for (const val of Object.values(obj)) {
                if (!foundControlUrl) findService(val);
              }
            }
            findService(parsed);

            if (foundControlUrl) {
              this.controlPath = foundControlUrl;
              logger.success('UPNP', `Auto-discovered RenderingControl URL: ${this.controlPath} from ${descUrl}`);
              return this.controlPath;
            }
          }
        }
      } catch {
        // try next endpoint
      }
    }

    return this.controlPath;
  }

  /**
   * Action: GetVolume (0-100) with 3000ms timeout
   */
  async getVolume(ip, port = this.port, controlPath = this.controlPath) {
    const bodyXml = `<InstanceID>0</InstanceID><Channel>Master</Channel>`;
    try {
      const res = await sendSoapRequest(ip, port, controlPath, 'GetVolume', bodyXml, this.timeoutMs);
      const volStr = extractTagValue(res.xml, 'CurrentVolume');
      if (volStr !== null) {
        const volume = parseInt(volStr, 10);
        logger.info('UPNP', `TV Current Volume: ${volume}%`);
        return { success: true, volume, raw: res.xml };
      }
      throw new Error('CurrentVolume tag missing in SOAP response');
    } catch (err) {
      // Only attempt dynamic discovery if the port responded but returned an HTTP error or missing tag, NOT on network timeout
      if (!err.isTimeout && controlPath === DEFAULT_CONTROL_PATH) {
        logger.warn('UPNP', `GetVolume failed on default path, checking service description...`);
        try {
          const resolved = await this.resolveControlPath(ip, port);
          if (resolved && resolved !== DEFAULT_CONTROL_PATH) {
            const retryRes = await sendSoapRequest(ip, port, resolved, 'GetVolume', bodyXml, this.timeoutMs);
            const volStr = extractTagValue(retryRes.xml, 'CurrentVolume');
            if (volStr !== null) {
              return { success: true, volume: parseInt(volStr, 10), raw: retryRes.xml };
            }
          }
        } catch {
          // Keep original error
        }
      }
      throw err;
    }
  }

  /**
   * Action: SetVolume (Forces absolute volume 0-100 directly onto Audio Renderer with 3000ms timeout)
   */
  async setVolume(ip, targetVolume, port = this.port, controlPath = this.controlPath) {
    const vol = Math.max(0, Math.min(100, Math.round(targetVolume)));
    const bodyXml = `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${vol}</DesiredVolume>`;

    logger.info('UPNP', `Bypass Trigger: Forcing absolute volume to ${vol}% via UPnP RenderingControl`);
    const res = await sendSoapRequest(ip, port, controlPath, 'SetVolume', bodyXml, this.timeoutMs);
    return {
      success: true,
      volume: vol,
      status: res.status
    };
  }

  /**
   * Action: GetMute (returns boolean)
   */
  async getMute(ip, port = this.port, controlPath = this.controlPath) {
    const bodyXml = `<InstanceID>0</InstanceID><Channel>Master</Channel>`;
    const res = await sendSoapRequest(ip, port, controlPath, 'GetMute', bodyXml, this.timeoutMs);
    const muteStr = extractTagValue(res.xml, 'CurrentMute');
    const isMuted = muteStr === '1' || muteStr === 'true';
    return {
      success: true,
      mute: isMuted,
      raw: res.xml
    };
  }

  /**
   * Action: SetMute (mute: boolean or 0/1)
   */
  async setMute(ip, mute, port = this.port, controlPath = this.controlPath) {
    const desired = mute ? '1' : '0';
    const bodyXml = `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${desired}</DesiredMute>`;

    logger.info('UPNP', `Bypass Trigger: Setting Mute=${desired} via UPnP RenderingControl`);
    const res = await sendSoapRequest(ip, port, controlPath, 'SetMute', bodyXml, this.timeoutMs);
    return {
      success: true,
      mute: Boolean(mute),
      status: res.status
    };
  }
}

export const upnpClient = new UpnpVolumeClient();
export default upnpClient;

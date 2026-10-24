import dgram from 'dgram';
import net from 'net';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from './logger.js';

const execAsync = promisify(exec);

// Standard Samsung Smart TV ports
export const SAMSUNG_PORTS = [8001, 8002, 9197, 7676];

/**
 * Sanitizes and extracts clean IP string
 */
export function sanitizeIp(ip) {
  if (!ip) return '';
  return String(ip).replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
}

/**
 * Gets all local IPv4 network interfaces
 */
export function getLocalInterfaces() {
  const interfaces = os.networkInterfaces();
  const list = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if ((addr.family === 'IPv4' || addr.family === 4) && !addr.internal) {
        list.push({
          name,
          address: addr.address,
          netmask: addr.netmask,
          isApipa: addr.address.startsWith('169.254.')
        });
      }
    }
  }
  return list;
}

/**
 * Parses the Windows ARP table to quickly find active LAN peers (ideal for 169.254.x.x link-local direct cable)
 */
export async function getArpTableIps() {
  const ips = [];
  try {
    const { stdout } = await execAsync('arp -a');
    const lines = stdout.split('\n');
    for (const line of lines) {
      const match = line.trim().match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F-]+)\s+(\w+)/);
      if (match) {
        const ip = match[1];
        const mac = match[2];
        const type = match[3];
        // Exclude broadcast and multicast addresses
        if (!ip.endsWith('.255') && !ip.startsWith('224.') && !ip.startsWith('239.') && ip !== '255.255.255.255') {
          ips.push({ ip, mac, type });
        }
      }
    }
  } catch (err) {
    logger.warn('SCAN', `Failed to read ARP table: ${err.message}`);
  }
  return ips;
}

/**
 * Fast TCP port probe with timeout
 */
export function checkPort(ip, port, timeout = 500) {
  return new Promise((resolve) => {
    const clean = sanitizeIp(ip);
    if (!clean) return resolve(false);

    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      status = true;
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('close', () => {
      resolve(status);
    });

    try {
      socket.connect(port, clean);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Checks all common Samsung ports on a specific IP
 */
export async function inspectPorts(ip, ports = SAMSUNG_PORTS, timeout = 700) {
  const results = {};
  const clean = sanitizeIp(ip);
  if (!clean) return results;

  const promises = ports.map(async (port) => {
    const open = await checkPort(clean, port, timeout);
    results[port] = open;
  });
  await Promise.all(promises);
  return results;
}

/**
 * Attempts to retrieve Samsung REST device info from port 8001
 */
export async function fetchSamsungDeviceInfo(ip, timeoutMs = 2000) {
  const clean = sanitizeIp(ip);
  if (!clean) return { reachable: false, data: null };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`http://${clean}:8001/api/v2/`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return {
        reachable: true,
        data,
        name: data?.name || data?.device?.name || 'Samsung TV',
        model: data?.device?.modelName || data?.device?.model || 'Unknown Model',
        powerState: data?.device?.PowerState || 'on',
        duid: data?.device?.duid || data?.id || '',
        networkType: data?.device?.networkType || 'wired'
      };
    }
  } catch {
    clearTimeout(timeoutId);
  }
  return { reachable: false, data: null };
}

/**
 * Attempts to fetch UPnP DMR device description XML from port 9197 or 7676
 */
export async function fetchUpnpDescription(ip, port = 9197, timeoutMs = 2000) {
  const clean = sanitizeIp(ip);
  if (!clean) return { reachable: false, url: null, xml: null };

  const endpoints = [
    `http://${clean}:${port}/dmr/SamsungMRDesc.xml`,
    `http://${clean}:${port}/upnp/device.xml`,
    `http://${clean}:${port}/description.xml`
  ];

  for (const url of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const xml = await res.text();
        return { reachable: true, url, xml };
      }
    } catch {
      clearTimeout(timeoutId);
    }
  }
  return { reachable: false, url: null, xml: null };
}

/**
 * Comprehensive probe of a single IP
 */
export async function probeIp(ip) {
  const clean = sanitizeIp(ip);
  if (!clean) return { ip: '', isSamsung: false, ports: {} };

  const portStatus = await inspectPorts(clean, SAMSUNG_PORTS, 600);

  let deviceInfo = null;
  let upnpInfo = null;

  if (portStatus[8001] || portStatus[8002]) {
    deviceInfo = await fetchSamsungDeviceInfo(clean);
  }

  if (portStatus[9197] || portStatus[7676]) {
    upnpInfo = await fetchUpnpDescription(clean, portStatus[9197] ? 9197 : 7676);
  }

  const isSamsung = Boolean(
    (deviceInfo && deviceInfo.reachable) ||
    (upnpInfo && upnpInfo.reachable && (upnpInfo.xml.includes('Samsung') || upnpInfo.xml.includes('RenderingControl'))) ||
    portStatus[8001] || portStatus[8002] || portStatus[9197]
  );

  return {
    ip: clean,
    isSamsung,
    ports: portStatus,
    deviceInfo: deviceInfo?.data || null,
    model: deviceInfo?.model || (isSamsung ? 'Samsung TV (Generic)' : null),
    name: deviceInfo?.name || (isSamsung ? 'Samsung Smart TV' : null),
    upnpAvailable: Boolean(upnpInfo?.reachable),
    upnpUrl: upnpInfo?.url || null
  };
}

/**
 * SSDP / UPnP Discovery Scanner using UDP Multicast & Broadcast (supports direct cable 169.254.x.x)
 */
export function discoverSsdp(durationMs = 3000) {
  return new Promise((resolve) => {
    const discovered = new Map();
    let socket;

    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (err) {
      logger.error('SCAN', `SSDP socket creation error: ${err.message}`);
      return resolve([]);
    }

    const mSearchMessages = [
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n',

      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: urn:samsung.com:device:RemoteControlReceiver:1\r\n\r\n',

      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: ssdp:all\r\n\r\n'
    ];

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString();
      const ip = rinfo.address;

      if (text.includes('Samsung') || text.includes('MediaRenderer') || text.includes('RenderingControl') || text.includes('9197') || text.includes('7676')) {
        let location = '';
        const locMatch = text.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
        if (locMatch) location = locMatch[1];

        let usn = '';
        const usnMatch = text.match(/USN:\s*([^\r\n]+)/i);
        if (usnMatch) usn = usnMatch[1];

        let server = '';
        const serverMatch = text.match(/SERVER:\s*([^\r\n]+)/i);
        if (serverMatch) server = serverMatch[1];

        if (!discovered.has(ip)) {
          discovered.set(ip, {
            ip,
            location,
            usn,
            server,
            raw: text.slice(0, 300)
          });
          logger.info('SCAN', `SSDP response from ${ip}`, { location, server });
        }
      }
    });

    socket.on('error', (err) => {
      logger.warn('SCAN', `SSDP Socket error: ${err.message}`);
    });

    try {
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
        } catch {}

        try {
          socket.addMembership('239.255.255.250');
        } catch {
          // Multicast join might not be permitted on some standalone interfaces
        }

        // Send all M-SEARCH queries to both Multicast (239.255.255.250) and Subnet Broadcast (255.255.255.255)
        for (const query of mSearchMessages) {
          const buf = Buffer.from(query);
          try {
            socket.send(buf, 0, buf.length, 1900, '239.255.255.250');
          } catch {}
          try {
            socket.send(buf, 0, buf.length, 1900, '255.255.255.255');
          } catch {}
        }
      });
    } catch (e) {
      logger.warn('SCAN', `SSDP bind exception: ${e.message}`);
    }

    setTimeout(() => {
      try {
        socket.close();
      } catch {}
      resolve(Array.from(discovered.values()));
    }, durationMs);
  });
}

/**
 * Scans local network, ARP table, and manual candidates
 * Handles both standard subnets and direct cable (169.254.x.x APIPA) seamlessly
 */
export async function scanSubnet(onProgress = null, manualIp = null) {
  logger.info('SCAN', 'Starting network discovery scan...');
  const candidates = new Set();
  const ifaces = getLocalInterfaces();

  // 1. If manual or saved IP is provided, always probe it
  const cleanManual = sanitizeIp(manualIp);
  if (cleanManual) {
    candidates.add(cleanManual);
    logger.info('SCAN', `Added manual candidate IP: ${cleanManual}`);
  }

  // 2. Read Windows ARP Table candidates (especially effective for direct cable)
  const arpEntries = await getArpTableIps();
  logger.info('SCAN', `Found ${arpEntries.length} active IP(s) in Windows ARP table.`);
  for (const entry of arpEntries) {
    candidates.add(entry.ip);
  }

  // 3. Check interface types
  let hasApipaOnly = ifaces.length > 0 && ifaces.every((i) => i.isApipa);
  if (hasApipaOnly) {
    logger.info('SCAN', 'Direct LAN cable mode (APIPA 169.254.x.x) detected. Using ARP & Broadcast discovery without full /16 scan.');
  }

  // 4. Add standard /24 subnets (skip 65,535 addresses on 169.254.x.x to avoid freezing)
  for (const iface of ifaces) {
    if (!iface.isApipa) {
      const parts = iface.address.split('.');
      if (parts.length === 4) {
        const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
        // Scan standard /24 subnet
        for (let i = 1; i <= 254; i++) {
          candidates.add(`${prefix}.${i}`);
        }
      }
    }
  }

  // 5. Fire parallel SSDP discovery (multicast + broadcast)
  const ssdpPromise = discoverSsdp(2500);

  // 6. Batch scan candidates for Samsung ports (8001, 8002, 9197)
  const candidateList = Array.from(candidates);
  const foundDevices = [];
  const batchSize = 35;
  let scannedCount = 0;

  for (let i = 0; i < candidateList.length; i += batchSize) {
    const chunk = candidateList.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (ip) => {
        const p8001 = await checkPort(ip, 8001, 350);
        const p8002 = !p8001 ? await checkPort(ip, 8002, 350) : false;
        const p9197 = await checkPort(ip, 9197, 350);

        if (p8001 || p8002 || p9197) {
          logger.success('SCAN', `Open Samsung TV port detected on ${ip}! Probing details...`);
          const fullInfo = await probeIp(ip);
          foundDevices.push(fullInfo);
        }
      })
    );

    scannedCount += chunk.length;
    if (onProgress) {
      onProgress({
        scanned: scannedCount,
        total: candidateList.length,
        found: foundDevices.length
      });
    }
  }

  // 7. Merge SSDP findings
  const ssdpResults = await ssdpPromise;
  for (const item of ssdpResults) {
    if (!foundDevices.some((d) => d.ip === item.ip)) {
      const fullInfo = await probeIp(item.ip);
      foundDevices.push(fullInfo);
    }
  }

  logger.info('SCAN', `Scan finished. Discovered ${foundDevices.length} candidate Samsung device(s).`);
  return foundDevices;
}

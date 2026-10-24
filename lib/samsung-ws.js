import WebSocket from 'ws';
import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '../config.json');

export class SamsungRemoteClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.ip = options.ip || '';
    this.port = options.port || 8002;
    this.token = options.token || '';
    this.appName = options.appName || 'SamsungTizenTool';
    this.ws = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'authorizing'
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.queue = [];
    this.connectingPromise = null;

    // Safety: ensure EventEmitter has at least one error listener
    this.on('error', (err) => {
      logger.error('WS', `SamsungRemoteClient handled error: ${err.message}`);
    });
  }

  setTarget(ip, port = 8002, token = '') {
    const changed = this.ip !== ip || this.port !== port || (token && this.token !== token);
    this.ip = ip;
    this.port = port;
    if (token) this.token = token;

    if (changed && this.status !== 'disconnected') {
      this.disconnect();
    }
  }

  async saveTokenToConfig(token) {
    this.token = token;
    try {
      let config = {};
      try {
        const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
        config = JSON.parse(raw);
      } catch {}

      config.wsToken = token;
      if (this.ip) config.tvIp = this.ip;
      await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      logger.success('WS', `Authentication Token saved to config.json: ${token}`);
    } catch (err) {
      logger.error('WS', `Failed to write token to config.json: ${err.message}`);
    }
  }

  /**
   * Builds the WebSocket connection URL
   */
  getWsUrl(port = this.port) {
    const encodedName = Buffer.from(this.appName).toString('base64');
    const protocol = port === 8002 ? 'wss' : 'ws';
    let url = `${protocol}://${this.ip}:${port}/api/v2/channels/samsung.remote.control?name=${encodedName}`;
    if (this.token && port === 8002) {
      url += `&token=${this.token}`;
    }
    return url;
  }

  connect(forcePort = null) {
    if (!this.ip) {
      logger.warn('WS', 'Cannot connect: TV IP address is not set');
      return Promise.reject(new Error('TV IP address is not set'));
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(true);
    }

    if (this.connectingPromise && !forcePort) {
      return this.connectingPromise;
    }

    const portToUse = forcePort || this.port;

    this.connectingPromise = new Promise((resolve, reject) => {
      this.status = 'connecting';
      this.emit('status', { status: this.status, ip: this.ip, port: portToUse });

      const url = this.getWsUrl(portToUse);
      logger.ws(`Connecting to Samsung TV WebSocket on ${url}...`);

      const wsOptions = {
        rejectUnauthorized: false,
        handshakeTimeout: 3500
      };

      try {
        this.ws = new WebSocket(url, wsOptions);
      } catch (err) {
        this.status = 'disconnected';
        this.connectingPromise = null;
        this.emit('status', { status: this.status, error: err.message });
        return reject(err);
      }

      let connectedResolved = false;

      this.ws.on('open', () => {
        logger.success('WS', `WebSocket handshake opened with ${this.ip}:${portToUse}`);
        this.status = 'authorizing';
        this.emit('status', { status: this.status, ip: this.ip, port: portToUse });

        // Start keep-alive ping
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try { this.ws.ping(); } catch {}
          }
        }, 15000);

        // If port 8001 (unencrypted), connection is ready immediately
        if (portToUse === 8001 && !connectedResolved) {
          connectedResolved = true;
          this.status = 'connected';
          this.connectingPromise = null;
          this.emit('status', { status: this.status, ip: this.ip, port: portToUse });
          resolve(true);
          this.flushQueue();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          logger.ws(`WS Received: ${msg.event || 'message'}`, msg);

          // Handle token authorization event
          if (msg.event === 'ms.channel.connect') {
            this.status = 'connected';
            this.emit('status', { status: this.status, ip: this.ip, port: portToUse });

            if (msg.data && msg.data.token) {
              const newToken = msg.data.token;
              this.saveTokenToConfig(newToken);
              this.emit('token', newToken);
            }

            if (!connectedResolved) {
              connectedResolved = true;
              this.connectingPromise = null;
              resolve(true);
            }

            // Flush queued keys if any
            this.flushQueue();
          } else if (msg.event === 'ms.channel.unauthorized') {
            logger.warn('WS', 'Unauthorized: User declined or TV requires pairing approval.');
            this.status = 'unauthorized';
            this.emit('status', { status: this.status, message: 'TV rejected pairing' });
          }
        } catch {
          // Non-JSON message
          logger.ws(`WS Raw Data: ${data.toString()}`);
        }
      });

      this.ws.on('error', (err) => {
        logger.error('WS', `WebSocket Error on port ${portToUse}: ${err.message}`);
        this.emit('error', err);

        // Try automatic fallback between 8002 and 8001
        if (portToUse === 8002 && !forcePort) {
          logger.info('WS', 'Port 8002 failed, attempting fallback to unencrypted port 8001...');
          this.disconnect();
          this.connect(8001).then(resolve).catch(reject);
          return;
        }

        if (!connectedResolved) {
          connectedResolved = true;
          this.connectingPromise = null;
          this.status = 'disconnected';
          this.emit('status', { status: this.status, error: err.message });
          reject(err);
        }
      });

      this.ws.on('close', (code, reason) => {
        logger.warn('WS', `WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
        clearInterval(this.pingTimer);
        this.status = 'disconnected';
        this.connectingPromise = null;
        this.emit('status', { status: this.status });
        this.ws = null;
      });

      // Safety timeout for initial connection
      setTimeout(() => {
        if (!connectedResolved && this.status === 'connecting') {
          logger.warn('WS', `Connection timeout to ${this.ip}:${portToUse}`);
          this.disconnect();
          this.connectingPromise = null;
          reject(new Error('Connection timeout to TV'));
        }
      }, 4500);
    });

    return this.connectingPromise;
  }

  disconnect() {
    clearInterval(this.pingTimer);
    this.connectingPromise = null;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.on('error', () => {});
        this.ws.terminate();
      } catch {}
      this.ws = null;
    }
    this.status = 'disconnected';
    this.emit('status', { status: this.status });
  }

  /**
   * Sends a key command to Samsung TV
   * @param {string} key - e.g. "KEY_VOLDOWN", "KEY_ENTER", "KEY_HOME"
   * @param {string} cmd - "Click" (default), "Press", or "Release"
   */
  async sendKey(key, cmd = 'Click') {
    if (!this.ip) {
      throw new Error('TV IP address is not configured');
    }

    // Connect if not yet open
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      try {
        await this.connect();
      } catch (err) {
        throw new Error(`Failed to establish TV WebSocket connection: ${err.message}`);
      }
    }

    // If still in CONNECTING state, wait for open
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('WebSocket connection timed out waiting to open'));
        }, 3000);

        const onOpen = () => {
          cleanup();
          resolve();
        };

        const onError = (e) => {
          cleanup();
          reject(e);
        };

        const cleanup = () => {
          clearTimeout(timer);
          if (this.ws) {
            this.ws.removeListener('open', onOpen);
            this.ws.removeListener('error', onError);
          }
        };

        this.ws.once('open', onOpen);
        this.ws.once('error', onError);
      });
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected to TV');
    }

    const payload = {
      method: 'ms.remote.control',
      params: {
        Cmd: cmd,
        DataOfCmd: key,
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey'
      }
    };

    return new Promise((resolve, reject) => {
      try {
        const jsonStr = JSON.stringify(payload);
        this.ws.send(jsonStr, (err) => {
          if (err) {
            logger.error('WS', `Failed to send key ${key}: ${err.message}`);
            return reject(err);
          }
          logger.info('WS', `Key Sent: [${key}] (${cmd})`, { payload });
          resolve({ success: true, key, cmd });
        });
      } catch (err) {
        logger.error('WS', `Exception sending key ${key}: ${err.message}`);
        reject(err);
      }
    });
  }

  flushQueue() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      this.sendKey(item.key, item.cmd).then(item.resolve).catch(item.reject);
    }
  }

  getStatus() {
    return {
      status: this.status,
      ip: this.ip,
      port: this.port,
      hasToken: Boolean(this.token),
      connected: this.status === 'connected' || (this.ws && this.ws.readyState === WebSocket.OPEN)
    };
  }
}

export const samsungRemote = new SamsungRemoteClient();
export default samsungRemote;

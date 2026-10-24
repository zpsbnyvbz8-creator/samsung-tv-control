import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import logger from './lib/logger.js';
import {
  scanSubnet,
  probeIp,
  inspectPorts,
  fetchSamsungDeviceInfo,
  fetchUpnpDescription,
  getLocalInterfaces,
  getArpTableIps,
  SAMSUNG_PORTS
} from './lib/scanner.js';
import upnpClient from './lib/upnp-volume.js';
import samsungRemote from './lib/samsung-ws.js';
import macroEngine from './lib/macro-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Global process error safety to keep server 100% resilient
process.on('uncaughtException', (err) => {
  logger.error('SYSTEM', `Uncaught exception prevented crash: ${err.message}`, err.stack);
});
process.on('unhandledRejection', (reason) => {
  logger.error('SYSTEM', `Unhandled rejection prevented crash: ${reason}`);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, 'public')));

// Helper to broadcast WS messages to all connected browser clients
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(msg);
      } catch {}
    }
  }
}

// Hook up event broadcasts
logger.on('new-log', (entry) => broadcast('log', entry));
logger.on('cleared', () => broadcast('logs-cleared', {}));

samsungRemote.on('status', (data) => broadcast('remote-status', data));
samsungRemote.on('token', (token) => broadcast('remote-token', { token }));
samsungRemote.on('error', (err) => {
  logger.error('WS', `Samsung TV connection notice: ${err.message}`);
});

macroEngine.on('state-change', (state) => broadcast('macro-state', state));
macroEngine.on('countdown', (data) => broadcast('macro-countdown', data));
macroEngine.on('complete', (data) => broadcast('macro-complete', data));

wss.on('connection', (ws) => {
  // Send initial state upon connection
  ws.send(JSON.stringify({
    type: 'init',
    payload: {
      remoteStatus: samsungRemote.getStatus(),
      macroStatus: macroEngine.getStatus(),
      recentLogs: logger.getLogs().slice(0, 100)
    }
  }));
});

// Load config helper
async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      tvIp: '',
      wsPort: 8002,
      wsToken: '',
      appName: 'SamsungTizenTool',
      upnpPort: 9197,
      upnpControlPath: '/upnp/control/RenderingControl1',
      autoConnect: true
    };
  }
}

// Save config helper
async function saveConfig(cfg) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

// --- REST API ROUTES ---

// 1. CONFIG & STATUS
app.get('/api/config', async (req, res) => {
  const cfg = await loadConfig();
  res.json(cfg);
});

app.post('/api/config', async (req, res) => {
  try {
    const current = await loadConfig();
    const updated = { ...current, ...req.body };
    await saveConfig(updated);

    if (updated.tvIp) {
      samsungRemote.setTarget(updated.tvIp, updated.wsPort || 8002, updated.wsToken || '');
      upnpClient.port = updated.upnpPort || 9197;
      if (updated.upnpControlPath) {
        upnpClient.controlPath = updated.upnpControlPath;
      }
    }

    logger.info('SYSTEM', `Configuration updated: IP=${updated.tvIp}, Port=${updated.wsPort}`);
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    remote: samsungRemote.getStatus(),
    macro: macroEngine.getStatus(),
    upnp: {
      port: upnpClient.port,
      controlPath: upnpClient.controlPath
    }
  });
});

// 2. NETWORK SCANNER & DISCOVERY
app.get('/api/interfaces', (req, res) => {
  const ifaces = getLocalInterfaces();
  res.json(ifaces);
});

app.get('/api/arp', async (req, res) => {
  const entries = await getArpTableIps();
  res.json(entries);
});

let isScanning = false;
app.get('/api/scan', async (req, res) => {
  if (isScanning) {
    return res.status(409).json({ error: 'A network scan is already in progress' });
  }
  isScanning = true;
  broadcast('scan-status', { scanning: true, progress: 0 });

  try {
    const devices = await scanSubnet((progress) => {
      broadcast('scan-status', { scanning: true, ...progress });
    });

    isScanning = false;
    broadcast('scan-status', { scanning: false, totalFound: devices.length });

    // If an active Samsung TV was discovered and no IP is configured yet, auto-select it
    if (devices.length > 0) {
      const bestCandidate = devices.find((d) => d.isSamsung) || devices[0];
      const cfg = await loadConfig();
      if (!cfg.tvIp && bestCandidate) {
        cfg.tvIp = bestCandidate.ip;
        await saveConfig(cfg);
        samsungRemote.setTarget(bestCandidate.ip, cfg.wsPort, cfg.wsToken);
        logger.info('SCAN', `Auto-selected TV IP: ${bestCandidate.ip}`);
      }
    }

    res.json({ success: true, devices });
  } catch (err) {
    isScanning = false;
    broadcast('scan-status', { scanning: false, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/probe', async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP address is required' });

  try {
    logger.info('SCAN', `Probing target IP: ${ip}...`);
    const info = await probeIp(ip);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. VOLUME BYPASS (UPNP / DLNA RENDERING CONTROL)
app.get('/api/volume', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.query.ip || cfg.tvIp;
  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });

  try {
    const result = await upnpClient.getVolume(ip);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/volume', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.body.ip || cfg.tvIp;
  const { volume } = req.body;

  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });
  if (volume === undefined || isNaN(volume)) return res.status(400).json({ error: 'Valid volume (0-100) is required' });

  try {
    const result = await upnpClient.setVolume(ip, Number(volume));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mute', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.query.ip || cfg.tvIp;
  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });

  try {
    const result = await upnpClient.getMute(ip);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mute', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.body.ip || cfg.tvIp;
  const { mute } = req.body;

  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });

  try {
    const result = await upnpClient.setMute(ip, Boolean(mute));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. VIRTUAL REMOTE (WEBSOCKET PORT 8001 / 8002)
app.post('/api/remote/connect', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.body.ip || cfg.tvIp;
  const port = req.body.port || cfg.wsPort || 8002;

  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });

  samsungRemote.setTarget(ip, port, cfg.wsToken);
  try {
    await samsungRemote.connect();
    res.json({ success: true, status: samsungRemote.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message, status: samsungRemote.getStatus() });
  }
});

app.post('/api/remote/disconnect', (req, res) => {
  samsungRemote.disconnect();
  res.json({ success: true, status: samsungRemote.getStatus() });
});

app.post('/api/remote/key', async (req, res) => {
  const { key, cmd = 'Click' } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });

  try {
    const result = await samsungRemote.sendKey(key, cmd);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. MACRO SEQUENCER & SETUP-SKIPPER
app.get('/api/macros', async (req, res) => {
  const macros = await macroEngine.loadMacros();
  res.json(macros);
});

app.post('/api/macros', async (req, res) => {
  try {
    const macros = req.body;
    if (!Array.isArray(macros)) return res.status(400).json({ error: 'Array of macros expected' });
    await macroEngine.saveMacros(macros);
    res.json({ success: true, count: macros.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/macros/start', async (req, res) => {
  try {
    const macro = req.body;
    // Execute asynchronously and return immediately with 200
    macroEngine.start(macro).catch((e) => {
      logger.error('MACRO', `Macro execution error: ${e.message}`);
    });
    res.json({ success: true, status: macroEngine.getStatus() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/macros/stop', (req, res) => {
  macroEngine.stop();
  res.json({ success: true, status: macroEngine.getStatus() });
});

app.post('/api/macros/pause', (req, res) => {
  macroEngine.pause();
  res.json({ success: true, status: macroEngine.getStatus() });
});

app.post('/api/macros/resume', (req, res) => {
  macroEngine.resume();
  res.json({ success: true, status: macroEngine.getStatus() });
});

app.get('/api/macros/status', (req, res) => {
  res.json(macroEngine.getStatus());
});

// 6. LIVE DIAGNOSTICS & PORT INSPECTOR
app.get('/api/diag/device-info', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.query.ip || cfg.tvIp;
  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });

  const info = await fetchSamsungDeviceInfo(ip);
  res.json(info);
});

app.get('/api/diag/upnp-desc', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.query.ip || cfg.tvIp;
  const port = req.query.port ? Number(req.query.port) : cfg.upnpPort || 9197;
  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });

  const desc = await fetchUpnpDescription(ip, port);
  res.json(desc);
});

app.post('/api/diag/inspect-ports', async (req, res) => {
  const cfg = await loadConfig();
  const ip = req.body.ip || cfg.tvIp;
  const ports = req.body.ports || [8001, 8002, 9197, 7676, 8000, 8080];
  if (!ip) return res.status(400).json({ error: 'TV IP address is not specified' });

  const results = await inspectPorts(ip, ports, 800);
  res.json({ ip, ports: results });
});

app.get('/api/logs', (req, res) => {
  res.json(logger.getLogs());
});

app.post('/api/logs/clear', (req, res) => {
  logger.clear();
  res.json({ success: true });
});

// Express error handling middleware
app.use((err, req, res, next) => {
  logger.warn('SYSTEM', `Express request warning: ${err.message}`);
  res.status(err.status || 400).json({ error: err.message });
});

// Start Server & Auto-init
const PORT = process.env.PORT || 3000;

async function bootstrap() {
  const cfg = await loadConfig();
  if (cfg.tvIp) {
    logger.info('SYSTEM', `Restoring saved TV target: ${cfg.tvIp}`);
    samsungRemote.setTarget(cfg.tvIp, cfg.wsPort || 8002, cfg.wsToken || '');
    upnpClient.port = cfg.upnpPort || 9197;
    if (cfg.upnpControlPath) {
      upnpClient.controlPath = cfg.upnpControlPath;
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    logger.success('SYSTEM', `Samsung TV Diagnostic & Control Suite running at http://localhost:${PORT}`);
    logger.info('SYSTEM', `Local Network Interfaces: ${getLocalInterfaces().map(i => `${i.name}: ${i.address}`).join(' | ')}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
});

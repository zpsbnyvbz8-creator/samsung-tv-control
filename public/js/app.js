import { VolumeController } from './volume.js';
import { RemoteController } from './remote.js';
import { MacroController } from './macros.js';
import { DiagnosticsController } from './diagnostics.js';

class SamsungApp {
  constructor() {
    this.config = {
      tvIp: '',
      wsPort: 8002,
      wsToken: '',
      upnpPort: 9197
    };

    this.isCloudMode = !['localhost', '127.0.0.1'].includes(location.hostname);
    this.bridgeUrl = localStorage.getItem('samsung_bridge_url') || '';

    this.ws = null;
    this.targetIpInput = document.getElementById('targetIpInput');
    this.btnSetIp = document.getElementById('btnSetIp');
    this.btnQuickScan = document.getElementById('btnQuickScan');
    this.wsStatusBadge = document.getElementById('wsStatusBadge');
    this.wsStatusText = document.getElementById('wsStatusText');
    this.upnpStatusBadge = document.getElementById('upnpStatusBadge');
    this.upnpStatusText = document.getElementById('upnpStatusText');

    this.cloudModeBanner = document.getElementById('cloudModeBanner');
    this.bridgeUrlInput = document.getElementById('bridgeUrlInput');
    this.btnSaveBridgeUrl = document.getElementById('btnSaveBridgeUrl');

    this.init();
  }

  async init() {
    this.initTabs();
    this.initCloudModeBanner();
    this.initNotificationContainer();

    // Initialize sub-controllers
    this.volume = new VolumeController(this);
    this.remote = new RemoteController(this);
    this.macros = new MacroController(this);
    this.diagnostics = new DiagnosticsController(this);

    // Load saved configuration from server
    await this.loadConfig();

    // Connect to Backend WebSocket
    this.connectBackendWs();

    // Event listeners
    this.btnSetIp.addEventListener('click', () => {
      this.handleSetIp();
    });

    this.targetIpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleSetIp();
      }
    });

    this.btnQuickScan.addEventListener('click', () => {
      this.switchTab('tab-scanner');
      this.diagnostics.startFullScan();
    });

    // If TV IP is already configured, query volume
    if (this.config.tvIp) {
      setTimeout(() => {
        this.volume.queryVolume();
      }, 800);
    }
  }

  initCloudModeBanner() {
    if (this.isCloudMode && this.cloudModeBanner) {
      this.cloudModeBanner.style.display = 'block';
      if (this.bridgeUrlInput) {
        this.bridgeUrlInput.value = this.bridgeUrl;
      }

      if (this.btnSaveBridgeUrl) {
        this.btnSaveBridgeUrl.addEventListener('click', () => {
          const val = this.bridgeUrlInput.value.trim().replace(/\/$/, '');
          this.bridgeUrl = val;
          localStorage.setItem('samsung_bridge_url', val);
          this.showNotification(val ? `Bridge-URL gespeichert: ${val}` : 'Bridge-URL entfernt', 'success');

          // Reconnect WS and reload config with new bridge
          this.connectBackendWs();
          this.loadConfig();
        });
      }
    }
  }

  getApiUrl(path) {
    if (this.isCloudMode && this.bridgeUrl) {
      return `${this.bridgeUrl.replace(/\/$/, '')}${path}`;
    }
    return path;
  }

  getWsUrl(path) {
    if (this.isCloudMode && this.bridgeUrl) {
      const base = this.bridgeUrl
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:')
        .replace(/\/$/, '');
      return `${base}${path}`;
    }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}${path}`;
  }

  initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        this.switchTab(targetTab);
      });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach((c) => {
      c.classList.toggle('active', c.id === tabId);
    });
  }

  getCurrentIp() {
    return this.config.tvIp || this.targetIpInput.value.trim();
  }

  async loadConfig() {
    try {
      const res = await fetch(this.getApiUrl('/api/config'));
      const data = await res.json();

      if (data.status === 'cloud_mode' && !this.bridgeUrl) {
        this.showNotification('Vercel Cloud-Modus aktiv: Bitte Bridge-URL eintragen oder lokal unter http://localhost:3000 nutzen.', 'warn');
        return;
      }

      this.config = data;
      if (this.config.tvIp) {
        this.targetIpInput.value = this.config.tvIp;
      }
    } catch (err) {
      console.warn('Could not load config', err);
    }
  }

  async setTargetIp(ip) {
    this.targetIpInput.value = ip;
    await this.handleSetIp();
  }

  async handleSetIp() {
    const ip = this.targetIpInput.value.trim();
    if (!ip) {
      this.showNotification('Bitte eine gültige IP-Adresse eingeben', 'warn');
      return;
    }

    try {
      const res = await fetch(this.getApiUrl('/api/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tvIp: ip })
      });
      const data = await res.json();
      if (res.ok) {
        this.config = data.config || { tvIp: ip };
        this.showNotification(`TV-Zieladresse gesetzt auf: ${ip}`, 'success');

        // Connect remote WS
        this.connectTvRemote(ip);

        // Query volume
        this.volume.queryVolume();
      }
    } catch (err) {
      this.showNotification(`Fehler beim Speichern der IP: ${err.message}`, 'error');
    }
  }

  async connectTvRemote(ip) {
    this.updateWsStatus('connecting');
    try {
      const res = await fetch(this.getApiUrl('/api/remote/connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip })
      });
      const data = await res.json();
      if (data.status) {
        this.updateWsStatus(data.status.status);
      }
    } catch {
      this.updateWsStatus('disconnected');
    }
  }

  updateWsStatus(status) {
    this.wsStatusBadge.className = `status-badge ${status}`;
    if (status === 'connected') {
      this.wsStatusText.textContent = 'WS: Verbunden';
    } else if (status === 'authorizing') {
      this.wsStatusText.textContent = 'WS: TV-Freigabe...';
      this.showNotification('Samsung TV fordert Genehmigung: Bitte auf dem TV "Zulassen" drücken!', 'info');
    } else if (status === 'connecting') {
      this.wsStatusText.textContent = 'WS: Verbindet...';
    } else {
      this.wsStatusText.textContent = 'WS: Getrennt';
    }
  }

  connectBackendWs() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    const wsUrl = this.getWsUrl('/ws');

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Connected to backend WebSocket via', wsUrl);
      };

      this.ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data);
          this.handleBackendEvent(type, payload);
        } catch (e) {
          console.error('WS parse error', e);
        }
      };

      this.ws.onclose = () => {
        setTimeout(() => {
          if (this.isCloudMode && !this.bridgeUrl) return;
          this.connectBackendWs();
        }, 3000);
      };

      this.ws.onerror = () => {
        // Handled silently
      };
    } catch (e) {
      console.warn('WebSocket connection not supported or blocked in this environment', e);
    }
  }

  handleBackendEvent(type, payload) {
    switch (type) {
      case 'init':
        if (payload.recentLogs && this.diagnostics) {
          payload.recentLogs.forEach((l) => this.diagnostics.addLog(l));
        }
        if (payload.remoteStatus) {
          this.updateWsStatus(payload.remoteStatus.status);
        }
        if (payload.macroStatus && this.macros) {
          this.macros.updateState(payload.macroStatus);
        }
        break;

      case 'log':
        if (this.diagnostics) {
          this.diagnostics.addLog(payload);
        }
        break;

      case 'remote-status':
        this.updateWsStatus(payload.status);
        break;

      case 'remote-token':
        this.showNotification(`Neues Samsung TV Token erhalten: ${payload.token}`, 'success');
        break;

      case 'macro-state':
        if (this.macros) {
          this.macros.updateState(payload);
        }
        break;

      case 'macro-countdown':
        if (this.macros) {
          this.macros.updateCountdown(payload);
        }
        break;

      case 'macro-complete':
        this.showNotification(`Makro "${payload.name}" erfolgreich abgeschlossen!`, 'success');
        break;

      default:
        break;
    }
  }

  initNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 9999;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.style.cssText = `
      background: var(--bg-surface-elevated);
      color: var(--text-main);
      border-radius: var(--radius-md);
      padding: 12px 18px;
      font-size: 0.88rem;
      border: 1px solid var(--border-subtle);
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 280px;
      max-width: 420px;
      pointer-events: auto;
      transform: translateY(10px);
      opacity: 0;
      transition: all 0.25s ease;
    `;

    if (type === 'success') {
      toast.style.borderColor = 'var(--accent-green)';
      toast.style.borderLeft = '4px solid var(--accent-green)';
    } else if (type === 'error') {
      toast.style.borderColor = 'var(--accent-red)';
      toast.style.borderLeft = '4px solid var(--accent-red)';
    } else if (type === 'warn') {
      toast.style.borderColor = 'var(--accent-amber)';
      toast.style.borderLeft = '4px solid var(--accent-amber)';
    } else {
      toast.style.borderColor = 'var(--accent-cyan)';
      toast.style.borderLeft = '4px solid var(--accent-cyan)';
    }

    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });

    setTimeout(() => {
      toast.style.transform = 'translateY(10px)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 4500);
  }
}

// Start application
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SamsungApp();
});

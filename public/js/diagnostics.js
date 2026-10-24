// Diagnostics, Port Inspector, Network Scanner & Live Logs Module
export class DiagnosticsController {
  constructor(app) {
    this.app = app;
    this.logs = [];
    this.logFilter = 'ALL';

    // Elements
    this.deviceInfoBox = document.getElementById('deviceInfoBox');
    this.btnFetchDeviceInfo = document.getElementById('btnFetchDeviceInfo');
    this.btnFetchUpnpDesc = document.getElementById('btnFetchUpnpDesc');
    this.btnInspectPorts = document.getElementById('btnInspectPorts');

    this.interfacesList = document.getElementById('interfacesList');
    this.arpSummary = document.getElementById('arpSummary');
    this.btnStartFullScan = document.getElementById('btnStartFullScan');
    this.scanStatusBadge = document.getElementById('scanStatusBadge');
    this.discoveredDevicesGrid = document.getElementById('discoveredDevicesGrid');

    this.logTerminal = document.getElementById('logTerminal');
    this.logFilterSelect = document.getElementById('logFilter');
    this.btnClearLogs = document.getElementById('btnClearLogs');
    this.btnCopyLogs = document.getElementById('btnCopyLogs');

    this.init();
  }

  init() {
    this.loadInterfacesAndArp();
    this.initListeners();
  }

  initListeners() {
    this.btnFetchDeviceInfo.addEventListener('click', () => this.fetchDeviceInfo());
    this.btnFetchUpnpDesc.addEventListener('click', () => this.fetchUpnpDesc());
    this.btnInspectPorts.addEventListener('click', () => this.inspectPorts());

    this.btnStartFullScan.addEventListener('click', () => this.startFullScan());

    this.logFilterSelect.addEventListener('change', (e) => {
      this.logFilter = e.target.value;
      this.renderLogs();
    });

    this.btnClearLogs.addEventListener('click', async () => {
      await fetch(this.app.getApiUrl('/api/logs/clear'), { method: 'POST' });
      this.logs = [];
      this.renderLogs();
    });

    this.btnCopyLogs.addEventListener('click', () => {
      const text = this.logs.map((l) => `[${l.timeFormatted}] [${l.category}] [${l.level}] ${l.message}`).join('\n');
      navigator.clipboard.writeText(text);
      this.app.showNotification('Logs in die Zwischenablage kopiert!', 'info');
    });
  }

  async loadInterfacesAndArp() {
    try {
      const [ifRes, arpRes] = await Promise.all([
        fetch(this.app.getApiUrl('/api/interfaces')),
        fetch(this.app.getApiUrl('/api/arp'))
      ]);
      const ifaces = await ifRes.json();
      const arps = await arpRes.json();

      this.interfacesList.innerHTML = ifaces
        .map((i) => `<div><strong>${i.name}:</strong> ${i.address} <span style="color:var(--text-dim)">(${i.isApipa ? 'Direkt-LAN/APIPA' : 'Subnetz'})</span></div>`)
        .join('');

      if (arps.length > 0) {
        this.arpSummary.innerHTML = arps
          .map((a) => `<div><span style="color:var(--accent-cyan); cursor:pointer;" class="arp-ip" data-ip="${a.ip}">${a.ip}</span> [${a.mac}]</div>`)
          .join('');

        // Make ARP IPs clickable to quickly set TV IP
        this.arpSummary.querySelectorAll('.arp-ip').forEach((el) => {
          el.addEventListener('click', () => {
            this.app.setTargetIp(el.dataset.ip);
          });
        });
      } else {
        this.arpSummary.innerHTML = '<span style="color:var(--text-dim)">Keine Nachbarn in ARP-Tabelle</span>';
      }
    } catch (e) {
      console.warn('Failed to load interfaces / ARP', e);
    }
  }

  async fetchDeviceInfo() {
    const ip = this.app.getCurrentIp();
    if (!ip) {
      this.app.showNotification('Bitte gib zuerst eine TV IP ein!', 'warn');
      return;
    }

    this.deviceInfoBox.textContent = '// Lade Samsung Device Info von http://' + ip + ':8001/api/v2/ ...';
    try {
      const res = await fetch(this.app.getApiUrl(`/api/diag/device-info?ip=${encodeURIComponent(ip)}`));
      const data = await res.json();
      this.deviceInfoBox.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      this.deviceInfoBox.textContent = `// FEHLER: ${err.message}`;
    }
  }

  async fetchUpnpDesc() {
    const ip = this.app.getCurrentIp();
    if (!ip) {
      this.app.showNotification('Bitte gib zuerst eine TV IP ein!', 'warn');
      return;
    }

    this.deviceInfoBox.textContent = '// Lade UPnP DMR XML von http://' + ip + ':9197/dmr/SamsungMRDesc.xml ...';
    try {
      const res = await fetch(this.app.getApiUrl(`/api/diag/upnp-desc?ip=${encodeURIComponent(ip)}`));
      const data = await res.json();
      if (data.reachable && data.xml) {
        this.deviceInfoBox.textContent = `// URL: ${data.url}\n\n` + data.xml;
      } else {
        this.deviceInfoBox.textContent = `// UPnP DMR nicht erreichbar auf Port 9197`;
      }
    } catch (err) {
      this.deviceInfoBox.textContent = `// FEHLER: ${err.message}`;
    }
  }

  async inspectPorts() {
    const ip = this.app.getCurrentIp();
    if (!ip) {
      this.app.showNotification('Bitte gib zuerst eine TV IP ein!', 'warn');
      return;
    }

    const p8001 = document.getElementById('p8001-stat');
    const p8002 = document.getElementById('p8002-stat');
    const p9197 = document.getElementById('p9197-stat');
    const p7676 = document.getElementById('p7676-stat');

    [p8001, p8002, p9197, p7676].forEach((el) => {
      el.textContent = 'Prüfe...';
      el.className = 'port-tag';
    });

    try {
      const res = await fetch(this.app.getApiUrl('/api/diag/inspect-ports'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, ports: [8001, 8002, 9197, 7676] })
      });
      const data = await res.json();

      const setBadge = (el, isOpen) => {
        el.textContent = isOpen ? 'OFFEN (Erreichbar)' : 'GESCHLOSSEN';
        el.className = `port-tag ${isOpen ? 'open' : 'closed'}`;
      };

      setBadge(p8001, data.ports[8001]);
      setBadge(p8002, data.ports[8002]);
      setBadge(p9197, data.ports[9197]);
      setBadge(p7676, data.ports[7676]);
    } catch (err) {
      this.app.showNotification(`Port-Inspector Fehler: ${err.message}`, 'error');
    }
  }

  async startFullScan() {
    this.scanStatusBadge.style.display = 'inline-flex';
    this.scanStatusBadge.textContent = 'Suchlauf läuft...';
    this.scanStatusBadge.className = 'status-badge connecting';
    this.discoveredDevicesGrid.innerHTML = `
      <div style="color:var(--accent-cyan); text-align:center; padding:30px; grid-column:1/-1;">
        <div style="font-size:1.1rem; font-weight:700;">📡 Subnetz & SSDP Discovery aktiv...</div>
        <div style="font-size:0.85rem; color:var(--text-muted); margin-top:6px;">Prüfe Ports 8001, 8002, 9197 und frage Samsung REST-Endpoints ab...</div>
      </div>
    `;

    try {
      const res = await fetch(this.app.getApiUrl('/api/scan'));
      const data = await res.json();

      this.scanStatusBadge.textContent = `Abgeschlossen (${data.devices.length} gefunden)`;
      this.scanStatusBadge.className = 'status-badge connected';

      this.renderDiscoveredDevices(data.devices);
      this.loadInterfacesAndArp();
    } catch (err) {
      this.scanStatusBadge.textContent = 'Scan fehlgeschlagen';
      this.scanStatusBadge.className = 'status-badge disconnected';
      this.discoveredDevicesGrid.innerHTML = `<div style="color:#ef4444; padding:20px;">Fehler: ${err.message}</div>`;
    }
  }

  renderDiscoveredDevices(devices) {
    if (!devices || devices.length === 0) {
      this.discoveredDevicesGrid.innerHTML = `
        <div style="color:var(--text-muted); text-align:center; padding:30px; grid-column:1/-1;">
          Keine Samsung TVs automatisch im Subnetz gefunden. Prüfe das LAN-Kabel oder gib die IP oben manuell ein.
        </div>
      `;
      return;
    }

    this.discoveredDevicesGrid.innerHTML = '';
    for (const dev of devices) {
      const card = document.createElement('div');
      card.className = `device-card ${dev.ip === this.app.getCurrentIp() ? 'selected' : ''}`;

      const portsHtml = Object.entries(dev.ports || {})
        .map(([port, isOpen]) => `<span class="port-tag ${isOpen ? 'open' : 'closed'}">:${port} ${isOpen ? '✔' : '✖'}</span>`)
        .join(' ');

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <strong style="font-size:1.05rem; color:var(--accent-cyan); font-family:var(--font-mono);">${dev.ip}</strong>
            <div style="font-size:0.85rem; font-weight:700; color:var(--text-main); margin-top:2px;">
              ${dev.name || 'Samsung TV'}
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">
              Modell: ${dev.model || 'Tizen Smart TV'}
            </div>
          </div>
          <button class="btn btn-primary" style="padding:6px 12px; font-size:0.8rem;" data-select-ip="${dev.ip}">
            Verwenden
          </button>
        </div>
        <div>
          <div style="font-size:0.7rem; color:var(--text-dim); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Erreichbare Ports:</div>
          <div class="port-tag-list">${portsHtml}</div>
        </div>
      `;

      card.querySelector('[data-select-ip]').addEventListener('click', () => {
        this.app.setTargetIp(dev.ip);
        this.renderDiscoveredDevices(devices);
      });

      this.discoveredDevicesGrid.appendChild(card);
    }
  }

  addLog(entry) {
    this.logs.unshift(entry);
    if (this.logs.length > 500) {
      this.logs.pop();
    }
    this.renderLogs();
  }

  renderLogs() {
    const filtered = this.logs.filter((log) => {
      if (this.logFilter === 'ALL') return true;
      if (this.logFilter === 'SOAP') return log.category === 'SOAP';
      if (this.logFilter === 'WS') return log.category === 'WS';
      if (this.logFilter === 'ERROR') return log.level === 'ERROR';
      return true;
    });

    this.logTerminal.innerHTML = filtered
      .map((log) => `
        <div class="log-entry">
          <span class="log-time">${log.timeFormatted}</span>
          <span class="log-category log-cat-${log.category}">${log.category}</span>
          <span class="log-level-${log.level}">${this.escapeHtml(log.message)}</span>
        </div>
      `)
      .join('');
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

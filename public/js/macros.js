// Macro Sequencer & Auto-Setup-Skipper Module
export class MacroController {
  constructor(app) {
    this.app = app;
    this.macros = [];
    this.currentMacro = null;
    this.isRecording = false;
    this.lastRecordTimestamp = 0;

    // Elements
    this.select = document.getElementById('macroSelect');
    this.stepList = document.getElementById('macroStepList');
    this.btnRun = document.getElementById('btnRunActiveMacro');
    this.btnPause = document.getElementById('btnPauseMacro');
    this.btnStop = document.getElementById('btnStopMacro');
    this.btnSave = document.getElementById('btnSaveMacros');
    this.btnNew = document.getElementById('btnNewMacro');
    this.btnToggleRecord = document.getElementById('btnToggleRecord');
    this.btnAddStep = document.getElementById('btnAddStep');
    this.newStepType = document.getElementById('newStepType');
    this.newStepVal = document.getElementById('newStepVal');

    this.progressBar = document.getElementById('macroProgressBar');
    this.activeName = document.getElementById('macroActiveName');
    this.statusPill = document.getElementById('macroStatusPill');
    this.stepDetail = document.getElementById('macroStepDetail');
    this.countdownTimer = document.getElementById('macroCountdownTimer');

    this.init();
  }

  async init() {
    await this.loadMacros();
    this.initListeners();
  }

  initListeners() {
    this.select.addEventListener('change', () => {
      const id = this.select.value;
      this.currentMacro = this.macros.find((m) => m.id === id) || this.macros[0];
      this.renderCurrentMacro();
    });

    this.btnRun.addEventListener('click', () => {
      this.startCurrentMacro();
    });

    this.btnPause.addEventListener('click', () => {
      this.togglePause();
    });

    this.btnStop.addEventListener('click', () => {
      this.stopMacro();
    });

    this.btnSave.addEventListener('click', () => {
      this.saveMacrosToServer();
    });

    this.btnNew.addEventListener('click', () => {
      this.createNewMacro();
    });

    this.btnToggleRecord.addEventListener('click', () => {
      this.toggleRecording();
    });

    this.btnAddStep.addEventListener('click', () => {
      this.addStepFromForm();
    });
  }

  async loadMacros() {
    try {
      const res = await fetch(this.app.getApiUrl('/api/macros'));
      this.macros = await res.json();
      this.renderDropdown();
      if (this.macros.length > 0) {
        this.currentMacro = this.macros[0];
        this.renderCurrentMacro();
      }
    } catch (err) {
      this.app.showNotification(`Fehler beim Laden der Makros: ${err.message}`, 'error');
    }
  }

  renderDropdown() {
    this.select.innerHTML = '';
    for (const m of this.macros) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      this.select.appendChild(opt);
    }
    if (this.currentMacro) {
      this.select.value = this.currentMacro.id;
    }
  }

  renderCurrentMacro() {
    if (!this.currentMacro) return;

    this.activeName.textContent = this.currentMacro.name;
    this.stepList.innerHTML = '';

    const steps = this.currentMacro.steps || [];
    steps.forEach((step, idx) => {
      const item = document.createElement('div');
      item.className = 'macro-step-item';
      item.dataset.index = idx;

      let badgeClass = 'step-type-key';
      let title = '';

      if (step.type === 'wait') {
        badgeClass = 'step-type-wait';
        title = `Pause: ${step.ms}ms`;
      } else if (step.type === 'volume') {
        badgeClass = 'step-type-volume';
        title = `SetVolume: ${step.volume}%`;
      } else {
        title = `Taste: ${step.key}`;
      }

      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:0.8rem; color:var(--text-dim); font-weight:700;">#${idx + 1}</span>
          <span class="step-type-badge ${badgeClass}">${step.type}</span>
          <strong style="font-size:0.9rem; font-family:var(--font-mono);">${title}</strong>
          ${step.description ? `<span style="font-size:0.8rem; color:var(--text-muted);">- ${step.description}</span>` : ''}
        </div>
        <div>
          <button class="btn btn-secondary btn-icon" style="height:28px; width:28px; padding:4px;" data-del="${idx}" title="Schritt löschen">
            ✕
          </button>
        </div>
      `;

      item.querySelector('[data-del]').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteStep(idx);
      });

      this.stepList.appendChild(item);
    });
  }

  deleteStep(idx) {
    if (!this.currentMacro) return;
    this.currentMacro.steps.splice(idx, 1);
    this.renderCurrentMacro();
  }

  addStepFromForm() {
    if (!this.currentMacro) return;
    const type = this.newStepType.value;
    const rawVal = this.newStepVal.value.trim();

    if (!rawVal) {
      this.app.showNotification('Bitte Wert für den Schritt eingeben!', 'warn');
      return;
    }

    let step = {};
    if (type === 'wait') {
      const ms = parseInt(rawVal.replace(/\D/g, ''), 10) || 1000;
      step = { type: 'wait', ms, description: `Warte ${ms}ms` };
    } else if (type === 'volume') {
      const vol = parseInt(rawVal.replace(/\D/g, ''), 10) || 20;
      step = { type: 'volume', volume: vol, description: `Lautstärke auf ${vol}%` };
    } else {
      let key = rawVal.toUpperCase();
      if (!key.startsWith('KEY_')) key = 'KEY_' + key;
      step = { type: 'key', key, description: `Drücke ${key}` };
    }

    this.currentMacro.steps.push(step);
    this.newStepVal.value = '';
    this.renderCurrentMacro();
  }

  createNewMacro() {
    const name = prompt('Name für das neue Makro:', 'Neues Makro');
    if (!name) return;

    const newMacro = {
      id: 'macro-' + Date.now(),
      name,
      description: 'Benutzerdefiniertes Makro',
      steps: []
    };

    this.macros.push(newMacro);
    this.currentMacro = newMacro;
    this.renderDropdown();
    this.renderCurrentMacro();
  }

  async saveMacrosToServer() {
    try {
      const res = await fetch(this.app.getApiUrl('/api/macros'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.macros)
      });
      const data = await res.json();
      if (res.ok) {
        this.app.showNotification('Makros erfolgreich in macros.json gespeichert!', 'success');
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      this.app.showNotification(`Fehler beim Speichern: ${err.message}`, 'error');
    }
  }

  toggleRecording() {
    this.isRecording = !this.isRecording;
    if (this.isRecording) {
      this.btnToggleRecord.classList.add('btn-danger');
      this.btnToggleRecord.innerHTML = '<span style="color:#ffffff;">■</span> Aufnahme läuft...';

      // Create or switch to record macro
      let recordMacro = this.macros.find((m) => m.id === 'recorded-live-macro');
      if (!recordMacro) {
        recordMacro = {
          id: 'recorded-live-macro',
          name: '🔴 Live Aufgenommenes Makro',
          description: 'Direkt per Fernbedienung aufgezeichnete Sequenz',
          steps: []
        };
        this.macros.unshift(recordMacro);
      } else {
        recordMacro.steps = [];
      }

      this.currentMacro = recordMacro;
      this.lastRecordTimestamp = Date.now();
      this.renderDropdown();
      this.renderCurrentMacro();
      this.app.showNotification('Aufnahme gestartet! Drücke jetzt Tasten auf der Fernbedienung oder Tastatur.', 'info');
    } else {
      this.btnToggleRecord.classList.remove('btn-danger');
      this.btnToggleRecord.innerHTML = '<span style="color:#ef4444;">●</span> Live-Aufnahme';
      this.app.showNotification(`Aufnahme beendet (${this.currentMacro.steps.length} Schritte). Klicke auf 'Speichern'.`, 'success');
    }
  }

  recordKeyStep(key) {
    if (!this.isRecording || !this.currentMacro) return;

    const now = Date.now();
    const elapsed = now - this.lastRecordTimestamp;
    this.lastRecordTimestamp = now;

    // Add pause if time passed
    if (elapsed > 150) {
      const roundedMs = Math.round(elapsed / 100) * 100;
      this.currentMacro.steps.push({
        type: 'wait',
        ms: roundedMs,
        description: `Warte ${roundedMs}ms`
      });
    }

    // Add key
    this.currentMacro.steps.push({
      type: 'key',
      key,
      description: `Drücke ${key}`
    });

    this.renderCurrentMacro();
  }

  async startCurrentMacro() {
    if (!this.currentMacro) return;

    const ip = this.app.getCurrentIp();
    if (!ip) {
      this.app.showNotification('Bitte gib zuerst die IP-Adresse des Fernsehers ein!', 'warn');
      return;
    }

    try {
      const res = await fetch(this.app.getApiUrl('/api/macros/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.currentMacro)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      this.updateState({
        status: 'running',
        currentStepIndex: 0,
        totalSteps: this.currentMacro.steps.length
      });
    } catch (err) {
      this.app.showNotification(`Makro-Start fehlgeschlagen: ${err.message}`, 'error');
    }
  }

  async togglePause() {
    const isPaused = this.btnPause.textContent === 'Fortsetzen';
    const endpoint = isPaused ? '/api/macros/resume' : '/api/macros/pause';
    try {
      await fetch(this.app.getApiUrl(endpoint), { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
  }

  async stopMacro() {
    try {
      await fetch(this.app.getApiUrl('/api/macros/stop'), { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
  }

  updateState(state) {
    const { status, currentStepIndex, totalSteps, currentStep, progress } = state;

    if (status === 'running') {
      this.btnRun.style.display = 'none';
      this.btnPause.style.display = 'inline-flex';
      this.btnPause.textContent = 'Pause';
      this.btnStop.style.display = 'inline-flex';
      this.statusPill.textContent = 'Läuft';
      this.statusPill.className = 'status-badge connected';
    } else if (status === 'paused') {
      this.btnRun.style.display = 'none';
      this.btnPause.style.display = 'inline-flex';
      this.btnPause.textContent = 'Fortsetzen';
      this.btnStop.style.display = 'inline-flex';
      this.statusPill.textContent = 'Pausiert';
      this.statusPill.className = 'status-badge connecting';
    } else {
      this.btnRun.style.display = 'inline-flex';
      this.btnPause.style.display = 'none';
      this.btnStop.style.display = 'none';
      this.statusPill.textContent = 'Bereit';
      this.statusPill.className = 'status-badge';
      this.countdownTimer.textContent = 'Wartet...';
    }

    this.progressBar.style.width = `${progress || 0}%`;
    this.stepDetail.textContent = totalSteps > 0
      ? `Schritt ${currentStepIndex + 1} von ${totalSteps}${currentStep ? `: [${currentStep.type.toUpperCase()}] ${currentStep.key || currentStep.ms + 'ms'}` : ''}`
      : 'Keine Schritte';

    // Highlight active step in DOM
    document.querySelectorAll('.macro-step-item').forEach((item) => {
      const idx = parseInt(item.dataset.index, 10);
      if (idx === currentStepIndex && status === 'running') {
        item.classList.add('active');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  updateCountdown(data) {
    this.countdownTimer.textContent = `Warten: ${data.remainingMs}ms verbleibend`;
  }
}

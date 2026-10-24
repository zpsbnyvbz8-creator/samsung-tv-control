// Virtual Remote Controller Module
export class RemoteController {
  constructor(app) {
    this.app = app;
    this.keyMap = {
      'ArrowUp': 'KEY_UP',
      'ArrowDown': 'KEY_DOWN',
      'ArrowLeft': 'KEY_LEFT',
      'ArrowRight': 'KEY_RIGHT',
      'Enter': 'KEY_ENTER',
      'Escape': 'KEY_RETURN',
      'Backspace': 'KEY_RETURN',
      'h': 'KEY_HOME',
      'H': 'KEY_HOME',
      's': 'KEY_SOURCE',
      'S': 'KEY_SOURCE',
      'p': 'KEY_POWER',
      'P': 'KEY_POWER'
    };

    this.initClickHandlers();
    this.initKeyboardHandlers();
  }

  initClickHandlers() {
    // Buttons with data-key
    document.querySelectorAll('[data-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        this.sendKey(key);
      });
    });

    // Power Button
    const btnPower = document.getElementById('btnKeyPower');
    if (btnPower) {
      btnPower.addEventListener('click', () => {
        this.sendKey('KEY_POWER');
      });
    }
  }

  initKeyboardHandlers() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is focusing an input or textarea
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      // Volume Bypass shortcuts via keyboard (+ / - / m)
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.app.volume.setAbsoluteVolume(Math.min(100, this.app.volume.currentVolume + 2));
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.app.volume.setAbsoluteVolume(Math.max(0, this.app.volume.currentVolume - 2));
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.app.volume.toggleMute();
        return;
      }

      // Remote Navigation keys
      const mappedKey = this.keyMap[e.key];
      if (mappedKey) {
        e.preventDefault();
        this.sendKey(mappedKey);

        // Visual flash on remote button
        const btn = document.querySelector(`[data-key="${mappedKey}"]`);
        if (btn) {
          btn.style.boxShadow = '0 0 15px var(--accent-cyan)';
          setTimeout(() => {
            btn.style.boxShadow = '';
          }, 180);
        }
      }
    });
  }

  async sendKey(key, cmd = 'Click') {
    const ip = this.app.getCurrentIp();
    if (!ip) {
      this.app.showNotification('Bitte gib zuerst die IP-Adresse des Fernsehers ein!', 'warn');
      return;
    }

    // Inform Macro Recorder if active
    if (this.app.macros && this.app.macros.isRecording) {
      this.app.macros.recordKeyStep(key);
    }

    try {
      const res = await fetch(this.app.getApiUrl('/api/remote/key'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, cmd })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Fehler beim Senden des Tastendrucks');
      }
    } catch (err) {
      this.app.showNotification(`Taste [${key}] fehlgeschlagen: ${err.message}`, 'error');
    }
  }
}

// Volume Bypass Module (UPnP SOAP RenderingControl)
export class VolumeController {
  constructor(app) {
    this.app = app;
    this.currentVolume = 20;
    this.isMuted = false;
    this.debounceTimer = null;

    this.slider = document.getElementById('volumeSlider');
    this.display = document.getElementById('volumeValueDisplay');
    this.muteBtnLabel = document.getElementById('muteBtnLabel');
    this.btnRefresh = document.getElementById('btnRefreshVolume');
    this.btnToggleMute = document.getElementById('btnToggleMute');

    this.initListeners();
  }

  initListeners() {
    // Slider Drag & Release
    this.slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.display.textContent = val;
      this.currentVolume = val;
    });

    this.slider.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      this.setAbsoluteVolume(val);
    });

    // Step Buttons (+/- buttons)
    document.querySelectorAll('.btn-step').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.step, 10);
        const newVol = Math.max(0, Math.min(100, this.currentVolume + delta));
        this.setAbsoluteVolume(newVol);
      });
    });

    // Preset Buttons
    document.querySelectorAll('.btn-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.preset, 10);
        this.setAbsoluteVolume(val);
      });
    });

    // Mute Toggle
    this.btnToggleMute.addEventListener('click', () => {
      this.toggleMute();
    });

    // Refresh Query
    this.btnRefresh.addEventListener('click', () => {
      this.queryVolume();
    });
  }

  updateUi(val, muted = null) {
    this.currentVolume = val;
    this.slider.value = val;
    this.display.textContent = val;

    if (muted !== null) {
      this.isMuted = muted;
      this.muteBtnLabel.textContent = muted ? 'Unmute' : 'Mute';
      if (muted) {
        this.btnToggleMute.classList.add('btn-danger');
      } else {
        this.btnToggleMute.classList.remove('btn-danger');
      }
    }
  }

  async setAbsoluteVolume(vol) {
    const ip = this.app.getCurrentIp();
    if (!ip) {
      this.app.showNotification('Bitte gib zuerst die IP-Adresse des Fernsehers ein!', 'warn');
      return;
    }

    this.updateUi(vol);

    try {
      const res = await fetch('/api/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, volume: vol })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Fehler beim Senden von SetVolume');
      }
      this.updateUi(data.volume);
    } catch (err) {
      this.app.showNotification(`Lautstärke-Bypass fehlgeschlagen: ${err.message}`, 'error');
    }
  }

  async toggleMute() {
    const ip = this.app.getCurrentIp();
    if (!ip) return;

    const newMute = !this.isMuted;
    try {
      const res = await fetch('/api/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, mute: newMute })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this.updateUi(this.currentVolume, data.mute);
    } catch (err) {
      this.app.showNotification(`Mute fehlgeschlagen: ${err.message}`, 'error');
    }
  }

  async queryVolume() {
    const ip = this.app.getCurrentIp();
    if (!ip) return;

    try {
      const res = await fetch(`/api/volume?ip=${encodeURIComponent(ip)}`);
      const data = await res.json();
      if (res.ok && data.volume !== undefined) {
        this.updateUi(data.volume);
        this.app.showNotification(`Lautstärke aktualisiert: ${data.volume}%`, 'success');
      }
    } catch (err) {
      this.app.showNotification(`GetVolume fehlgeschlagen: ${err.message}`, 'warn');
    }
  }
}

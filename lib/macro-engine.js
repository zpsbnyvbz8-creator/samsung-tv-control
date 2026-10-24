import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import samsungRemote from './samsung-ws.js';
import upnpClient from './upnp-volume.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MACROS_PATH = path.resolve(__dirname, '../macros.json');

export class MacroEngine extends EventEmitter {
  constructor() {
    super();
    this.status = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped'
    this.currentMacroId = null;
    this.currentMacroName = '';
    this.steps = [];
    this.currentStepIndex = -1;
    this.abortController = null;
    this.pausePromise = null;
    this.resolvePause = null;
  }

  async loadMacros() {
    try {
      const data = await fs.readFile(MACROS_PATH, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      logger.error('MACRO', `Failed to load macros.json: ${err.message}`);
      return [];
    }
  }

  async saveMacros(macros) {
    try {
      await fs.writeFile(MACROS_PATH, JSON.stringify(macros, null, 2), 'utf-8');
      logger.success('MACRO', 'Macros successfully saved to macros.json');
      return true;
    } catch (err) {
      logger.error('MACRO', `Failed to save macros.json: ${err.message}`);
      throw err;
    }
  }

  getStatus() {
    return {
      status: this.status,
      currentMacroId: this.currentMacroId,
      currentMacroName: this.currentMacroName,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      currentStep: this.steps[this.currentStepIndex] || null,
      progress: this.steps.length > 0 ? Math.round(((this.currentStepIndex + 1) / this.steps.length) * 100) : 0
    };
  }

  emitState() {
    this.emit('state-change', this.getStatus());
  }

  async sleepWithAbort(ms) {
    const checkInterval = 100;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this.status === 'stopped') {
        throw new Error('Macro stopped by user');
      }

      // Check if paused
      if (this.status === 'paused' && this.pausePromise) {
        await this.pausePromise;
      }

      const toWait = Math.min(checkInterval, ms - elapsed);
      await new Promise((r) => setTimeout(r, toWait));
      elapsed += toWait;

      const remaining = Math.max(0, ms - elapsed);
      this.emit('countdown', {
        stepIndex: this.currentStepIndex,
        totalSteps: this.steps.length,
        remainingMs: remaining,
        totalMs: ms
      });
    }
  }

  async start(macro) {
    if (this.status === 'running') {
      throw new Error('Another macro is already running');
    }

    if (!macro || !Array.isArray(macro.steps) || macro.steps.length === 0) {
      throw new Error('Macro has no steps to execute');
    }

    this.status = 'running';
    this.currentMacroId = macro.id || 'custom-macro';
    this.currentMacroName = macro.name || 'Custom Macro';
    this.steps = macro.steps;
    this.currentStepIndex = -1;
    this.pausePromise = null;

    logger.info('MACRO', `Starting Macro: "${this.currentMacroName}" (${this.steps.length} steps)`);
    this.emitState();

    try {
      for (let i = 0; i < this.steps.length; i++) {
        if (this.status === 'stopped') {
          break;
        }

        // Handle pause
        if (this.status === 'paused' && this.pausePromise) {
          await this.pausePromise;
        }

        this.currentStepIndex = i;
        const step = this.steps[i];
        this.emitState();

        logger.info('MACRO', `Step [${i + 1}/${this.steps.length}]: ${step.type.toUpperCase()} ${step.key || step.ms + 'ms' || ''} - ${step.description || ''}`);

        switch (step.type) {
          case 'key':
            await samsungRemote.sendKey(step.key, step.cmd || 'Click');
            // Small implicit throttle between keystrokes to ensure TV processes
            await this.sleepWithAbort(step.postDelay || 150);
            break;

          case 'wait':
            await this.sleepWithAbort(step.ms || 500);
            break;

          case 'volume':
            if (samsungRemote.ip && step.volume !== undefined) {
              await upnpClient.setVolume(samsungRemote.ip, step.volume);
            }
            break;

          case 'mute':
            if (samsungRemote.ip && step.mute !== undefined) {
              await upnpClient.setMute(samsungRemote.ip, step.mute);
            }
            break;

          default:
            logger.warn('MACRO', `Unknown macro step type: ${step.type}`);
        }
      }

      if (this.status === 'running') {
        this.status = 'idle';
        logger.success('MACRO', `Macro "${this.currentMacroName}" completed successfully!`);
        this.emit('complete', { macroId: this.currentMacroId, name: this.currentMacroName });
      }
    } catch (err) {
      if (this.status === 'stopped') {
        logger.warn('MACRO', `Macro "${this.currentMacroName}" was aborted by user.`);
      } else {
        logger.error('MACRO', `Macro "${this.currentMacroName}" failed: ${err.message}`);
        this.emit('error', err);
      }
      this.status = 'idle';
    } finally {
      this.emitState();
    }
  }

  stop() {
    if (this.status === 'running' || this.status === 'paused') {
      this.status = 'stopped';
      if (this.resolvePause) {
        this.resolvePause();
      }
      logger.info('MACRO', 'Macro stop signal dispatched.');
      this.emitState();
    }
  }

  pause() {
    if (this.status === 'running') {
      this.status = 'paused';
      this.pausePromise = new Promise((resolve) => {
        this.resolvePause = resolve;
      });
      logger.info('MACRO', 'Macro execution paused.');
      this.emitState();
    }
  }

  resume() {
    if (this.status === 'paused') {
      this.status = 'running';
      if (this.resolvePause) {
        this.resolvePause();
        this.resolvePause = null;
        this.pausePromise = null;
      }
      logger.info('MACRO', 'Macro execution resumed.');
      this.emitState();
    }
  }
}

export const macroEngine = new MacroEngine();
export default macroEngine;

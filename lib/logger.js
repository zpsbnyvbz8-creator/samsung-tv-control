import EventEmitter from 'events';

class AppLogger extends EventEmitter {
  constructor(maxLogs = 300) {
    super();
    this.maxLogs = maxLogs;
    this.logs = [];
  }

  log(level, category, message, meta = null) {
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      timestamp: new Date().toISOString(),
      timeFormatted: new Date().toLocaleTimeString(),
      level: level.toUpperCase(), // INFO, SUCCESS, WARN, ERROR, DEBUG
      category: category.toUpperCase(), // WS, SOAP, SCAN, UPNP, MACRO, SYSTEM
      message,
      meta: meta ? (typeof meta === 'object' ? meta : { data: meta }) : null
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    // Console output with color formatting
    const prefix = `[${entry.timeFormatted}] [${entry.category}] [${entry.level}]`;
    if (entry.level === 'ERROR') {
      console.error(`${prefix} ${message}`, meta || '');
    } else if (entry.level === 'WARN') {
      console.warn(`${prefix} ${message}`, meta || '');
    } else {
      console.log(`${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
    }

    this.emit('new-log', entry);
    return entry;
  }

  info(category, message, meta) {
    return this.log('INFO', category, message, meta);
  }

  success(category, message, meta) {
    return this.log('SUCCESS', category, message, meta);
  }

  warn(category, message, meta) {
    return this.log('WARN', category, message, meta);
  }

  error(category, message, meta) {
    return this.log('ERROR', category, message, meta);
  }

  soap(message, meta) {
    return this.log('INFO', 'SOAP', message, meta);
  }

  ws(message, meta) {
    return this.log('INFO', 'WS', message, meta);
  }

  getLogs() {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.emit('cleared');
  }
}

export const logger = new AppLogger();
export default logger;

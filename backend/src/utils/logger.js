const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
  info:  (...a) => { if (isDev) console.log(...a); },
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  debug: (...a) => { if (isDev) console.log('[debug]', ...a); },
};

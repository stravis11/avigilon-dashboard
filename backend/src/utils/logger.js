const isDev = process.env.NODE_ENV !== 'production';

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|nonce|api[_-]?key|credential|private[_-]?key|user[_-]?key/i;

function redactValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object' && !(value instanceof Error)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return value;
}

function safeArgs(args) {
  return args.map((arg) => {
    if (arg instanceof Error) return arg;
    if (arg && typeof arg === 'object') {
      try {
        return redactValue(arg);
      } catch {
        return arg;
      }
    }
    return arg;
  });
}

export const logger = {
  info:  (...a) => { if (isDev) console.log(...safeArgs(a)); },
  warn:  (...a) => console.warn(...safeArgs(a));
  error: (...a) => console.error(...safeArgs(a));
  debug: (...a) => { if (isDev) console.log('[debug]', ...safeArgs(a)); },
};

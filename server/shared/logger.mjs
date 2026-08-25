function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (/authorization|cookie|token|password|secret|prompt|html|screenshot/i.test(key)) continue;
    if (typeof value === 'string' && value.length > 500) result[key] = `${value.slice(0, 497)}...`;
    else result[key] = value;
  }
  return result;
}

export function createLogger({ sink = console, environment = process.env.NODE_ENV || 'development' } = {}) {
  const write = (level, event, meta) => {
    const record = { event, ...cleanMeta(meta) };
    if (environment !== 'production') record.at = new Date().toISOString();
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    sink[method]?.(JSON.stringify(record));
  };
  return Object.freeze({
    info: (event, meta) => write('info', event, meta),
    warn: (event, meta) => write('warn', event, meta),
    error: (event, meta) => write('error', event, meta),
  });
}

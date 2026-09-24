type Level = 'debug' | 'info' | 'warn' | 'error';
type Context = Record<string, unknown>;

export function logger(module: string) {
  const at = (level: Level) => (msg: string, ctx?: Context) =>
    console[level](`[${module}] ${msg}`, ...(ctx ? [ctx] : []));
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

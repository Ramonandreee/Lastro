/**
 * Logger estruturado (JSON) — observabilidade sem dependências externas.
 * ────────────────────────────────────────────────────────────────────
 * Emite uma linha JSON por evento (nível, mensagem, campos), fácil de indexar
 * em qualquer coletor de logs. Cada requisição recebe um `rid` (request id) para
 * correlação ponta-a-ponta. Nunca registrar dados sensíveis (PII/segredos).
 *
 * Uso:
 *   import { reqId, logger } from '../lib/log.js';
 *   const rid = reqId(); const log = logger(rid, { fn: 'crypto' });
 *   log.info('ok', { ms: 120 });
 */
export function reqId() {
  // id curto e suficientemente único p/ correlação (não é segredo/segurança)
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function log(level, msg, fields) {
  try {
    console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(fields || {}) }));
  } catch {
    console.log(level, msg);
  }
}

export function logger(rid, base) {
  const b = { rid, ...(base || {}) };
  return {
    info: (m, f) => log('info', m, { ...b, ...(f || {}) }),
    warn: (m, f) => log('warn', m, { ...b, ...(f || {}) }),
    error: (m, f) => log('error', m, { ...b, ...(f || {}) }),
  };
}

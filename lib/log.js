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

/**
 * Envolve um handler de Serverless Function com observabilidade uniforme, SEM
 * alterar a lógica: gera request-id (header x-request-id), mede a duração e emite
 * um log JSON (done/erro com ep/status/ms). Uso:
 *   export default withObs('quotes', async function handler(req, res){ ... });
 */
export function withObs(ep, handler) {
  return async function (req, res) {
    const rid = reqId();
    try { res.setHeader('x-request-id', rid); } catch { /* headers podem já ter saído */ }
    const t0 = Date.now();
    try {
      const r = await handler(req, res);
      log('info', 'done', { rid, ep, status: res.statusCode, ms: Date.now() - t0 });
      return r;
    } catch (e) {
      log('error', 'erro', { rid, ep, ms: Date.now() - t0, err: String((e && e.message) || e) });
      if (!res.headersSent) { try { res.setHeader('Cache-Control', 'no-store'); } catch { /* noop */ } res.status(500).json({ error: 'erro interno' }); }
    }
  };
}

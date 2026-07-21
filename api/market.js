/**
 * Despachante de dados de mercado + health — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Consolida vários endpoints num ÚNICO Serverless Function (para caber no limite
 * de 12 funções do plano da Vercel). Cada handler mora em lib/ (que a Vercel NÃO
 * conta como função) e é despachado por ?fn=. Também expõe o health/readiness.
 *
 *   GET /api/market?fn=crypto&n=100
 *   GET /api/market?fn=usuniverse
 *   GET /api/market?fn=usdetail&symbol=AAPL
 *   GET /api/market?fn=history&symbols=PETR4&us=AAPL&crypto=BTC&days=40
 *   GET /api/market?fn=health          → readiness (200) + upstreams configurados
 *
 * Observabilidade: cada requisição recebe um request-id (header x-request-id) e
 * um log JSON estruturado (nível/fn/status/ms) para correlação ponta-a-ponta.
 */
import crypto from '../lib/crypto.js';
import usuniverse from '../lib/usuniverse.js';
import usdetail from '../lib/usdetail.js';
import history from '../lib/history.js';
import { reqId, logger } from '../lib/log.js';

const HANDLERS = { crypto, usuniverse, usdetail, history };

// Health/readiness: reporta SÓ a PRESENÇA de config (booleano) — nunca o valor dos segredos.
function health(res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    service: 'lastro',
    version: '1.1.0',
    time: new Date().toISOString(),
    region: process.env.VERCEL_REGION || null,
    upstreams: {
      brapi: !!process.env.BRAPI_TOKEN,
      fmp: !!process.env.FMP_KEY,
      supabase: !!process.env.SUPABASE_URL,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
  });
}

export default async function handler(req, res) {
  const fn = String((req.query && req.query.fn) || '').toLowerCase();
  const rid = reqId();
  res.setHeader('x-request-id', rid);
  const log = logger(rid, { fn });

  if (fn === 'health') return health(res);

  const h = HANDLERS[fn];
  if (!h) {
    log.warn('fn inválido');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'fn inválido (crypto|usuniverse|usdetail|history|health)' });
  }

  const t0 = Date.now();
  try {
    const r = await h(req, res);
    log.info('done', { ms: Date.now() - t0, status: res.statusCode });
    return r;
  } catch (e) {
    log.error('erro', { ms: Date.now() - t0, err: String((e && e.message) || e) });   // detalhe no log, não ao cliente
    if (!res.headersSent) { res.setHeader('Cache-Control', 'no-store'); res.status(500).json({ error: 'erro interno' }); }
  }
}

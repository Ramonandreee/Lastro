/**
 * Despachante de dados de mercado — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Consolida vários endpoints num ÚNICO Serverless Function (para caber no limite
 * de 12 funções do plano da Vercel). Cada handler mora em lib/ (que a Vercel NÃO
 * conta como função) e é despachado por ?fn=.
 *
 *   GET /api/market?fn=crypto&n=100
 *   GET /api/market?fn=usuniverse
 *   GET /api/market?fn=usdetail&symbol=AAPL
 *   GET /api/market?fn=history&symbols=PETR4&us=AAPL&crypto=BTC&days=40
 */
import crypto from '../lib/crypto.js';
import usuniverse from '../lib/usuniverse.js';
import usdetail from '../lib/usdetail.js';
import history from '../lib/history.js';

const HANDLERS = { crypto, usuniverse, usdetail, history };

export default async function handler(req, res) {
  const fn = String((req.query && req.query.fn) || '').toLowerCase();
  const h = HANDLERS[fn];
  if (!h) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'fn inválido (crypto|usuniverse|usdetail|history)' }); }
  return h(req, res);
}

/**
 * Testes do calendário de proventos (lib/dividends.js).
 * O risco aqui é DATA: uma data inventada/errada faz o usuário se planejar por
 * um pagamento que não existe. Os testes travam a regra "sem data real → fora".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { isoDate, tipoProvento, normEvent, dedupeSort, inWindow } from '../lib/dividends.js';

test('isoDate: formatos reais da brapi/B3 → YYYY-MM-DD (UTC)', () => {
  assert.equal(isoDate('2026-06-15T00:00:00.000Z'), '2026-06-15');
  assert.equal(isoDate('2026-06-15 00:00:00'), '2026-06-15');
  assert.equal(isoDate('15/06/2026'), '2026-06-15');
  assert.equal(isoDate(Date.UTC(2026, 5, 15)), '2026-06-15');       // epoch ms
  assert.equal(isoDate(Date.UTC(2026, 5, 15) / 1000), '2026-06-15'); // epoch s
});

test('isoDate: sentinelas e datas implausíveis → null (nunca chuta)', () => {
  assert.equal(isoDate(null), null);
  assert.equal(isoDate(''), null);
  assert.equal(isoDate('0000-00-00'), null);
  assert.equal(isoDate('a definir'), null);
  assert.equal(isoDate(0), null);                 // epoch 0 → 1970, fora do plausível
  assert.equal(isoDate('1970-01-01'), null);
  assert.equal(isoDate('2099-01-01'), null);
});

test('tipoProvento: rótulos da B3', () => {
  assert.equal(tipoProvento('DIVIDENDO'), 'DIVIDENDO');
  assert.equal(tipoProvento('JRS CAP PROPRIO'), 'JCP');
  assert.equal(tipoProvento('RENDIMENTO'), 'RENDIMENTO');
  assert.equal(tipoProvento(''), null);
  assert.equal(tipoProvento('OUTRO PROVENTO'), 'OUTRO PROVENTO'); // desconhecido: ecoa, não inventa
});

test('normEvent: evento completo da brapi', () => {
  const e = normEvent({
    rate: 0.11, label: 'RENDIMENTO', relatedTo: 'Junho/2026',
    approvedOn: '2026-06-05T00:00:00.000Z', lastDatePrior: '2026-06-12T00:00:00.000Z',
    paymentDate: '2026-06-16T00:00:00.000Z',
  });
  assert.deepEqual(e, {
    tipo: 'RENDIMENTO', valor: 0.11, dataCom: '2026-06-12',
    dataPagamento: '2026-06-16', dataAprovacao: '2026-06-05', relativoA: 'Junho/2026',
  });
});

test('normEvent: sem NENHUMA data real → descartado', () => {
  assert.equal(normEvent({ rate: 1.2, label: 'DIVIDENDO', approvedOn: '2026-06-05' }), null);
  assert.equal(normEvent({ rate: 1.2, paymentDate: '0000-00-00', lastDatePrior: null }), null);
});

test('normEvent: só data-com (pagamento a definir) → entra com dataPagamento null', () => {
  const e = normEvent({ rate: 1.5, label: 'DIVIDENDO', lastDatePrior: '2026-08-10' });
  assert.equal(e.dataCom, '2026-08-10');
  assert.equal(e.dataPagamento, null);   // ausente permanece ausente
});

test('normEvent: valor inválido/zero → descartado', () => {
  assert.equal(normEvent({ rate: 0, paymentDate: '2026-06-16' }), null);
  assert.equal(normEvent({ rate: 'x', paymentDate: '2026-06-16' }), null);
});

test('dedupeSort: remove duplicata e ordena por data', () => {
  const a = { tipo: 'DIVIDENDO', valor: 1, dataCom: '2026-03-01', dataPagamento: '2026-03-10' };
  const b = { tipo: 'DIVIDENDO', valor: 2, dataCom: '2026-01-01', dataPagamento: '2026-01-10' };
  const out = dedupeSort([a, b, { ...a }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.dataPagamento), ['2026-01-10', '2026-03-10']);
});

test('inWindow: usa pagamento; cai na data-com quando não há pagamento', () => {
  assert.equal(inWindow({ dataPagamento: '2026-06-16', dataCom: '2026-06-12' }, '2026-06-01', '2026-12-31'), true);
  assert.equal(inWindow({ dataPagamento: null, dataCom: '2026-06-12' }, '2026-06-01', '2026-12-31'), true);
  assert.equal(inWindow({ dataPagamento: '2025-01-02', dataCom: null }, '2026-06-01', '2026-12-31'), false);
  assert.equal(inWindow({ dataPagamento: null, dataCom: null }, '2026-06-01', '2026-12-31'), false);
});

/* ── handler (fetch stubado: nada de rede nos testes) ─────────────── */

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('handler: sem BRAPI_TOKEN → results vazio, sem quebrar', async () => {
  const old = process.env.BRAPI_TOKEN; delete process.env.BRAPI_TOKEN;
  const res = fakeRes();
  await handler({ query: { symbols: 'PETR4' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.results, {});
  assert.equal(res.body.meta.configured, false);
  if (old != null) process.env.BRAPI_TOKEN = old;
});

test('handler: lote entrega dividendsData → marca futuro e filtra janela', async () => {
  const oldFetch = global.fetch, oldTok = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'tk';
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ results: [
        { symbol: 'MXRF11', dividendsData: { cashDividends: [
          { rate: 0.10, label: 'RENDIMENTO', lastDatePrior: dia(-30), paymentDate: dia(-25) },
          { rate: 0.11, label: 'RENDIMENTO', lastDatePrior: dia(3), paymentDate: dia(9) },   // futuro
          { rate: 0.09, label: 'RENDIMENTO', lastDatePrior: dia(-900), paymentDate: dia(-890) }, // fora da janela
          { rate: 0.12, label: 'RENDIMENTO' },                                                // sem data → fora
        ] } },
        { symbol: 'PETR4', dividendsData: { cashDividends: [
          { rate: 1.23, label: 'JRS CAP PROPRIO', lastDatePrior: dia(10), paymentDate: null },
        ] } },
      ] }),
    };
  };
  const res = fakeRes();
  await handler({ query: { symbols: 'mxrf11, petr4' } }, res);
  global.fetch = oldFetch; if (oldTok == null) delete process.env.BRAPI_TOKEN; else process.env.BRAPI_TOKEN = oldTok;

  assert.equal(calls, 1, 'os 2 tickers cabem numa única chamada em lote');
  assert.equal(res.body.results.MXRF11.length, 2);
  assert.equal(res.body.results.MXRF11[1].futuro, true);
  assert.equal(res.body.results.PETR4[0].tipo, 'JCP');
  assert.equal(res.body.results.PETR4[0].dataPagamento, null);
  assert.equal(res.body.meta.lote, true);
  assert.equal(res.body.meta.futuros, 2);
});

test('handler: brapi sem dividendsData no lote → refaz ticker a ticker', async () => {
  const oldFetch = global.fetch, oldTok = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'tk';
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    const lote = url.includes('PETR4,VALE3') || url.includes('PETR4%2CVALE3');
    if (lote) return { ok: true, json: async () => ({ results: [{ symbol: 'PETR4' }, { symbol: 'VALE3' }] }) };
    const sym = /quote\/([A-Z0-9]+)\?/.exec(url)[1];
    return { ok: true, json: async () => ({ results: [{ symbol: sym, dividendsData: { cashDividends: [
      { rate: 1, label: 'DIVIDENDO', lastDatePrior: dia(5), paymentDate: dia(12) },
    ] } }] }) };
  };
  const res = fakeRes();
  await handler({ query: { symbols: 'PETR4,VALE3' } }, res);
  global.fetch = oldFetch; if (oldTok == null) delete process.env.BRAPI_TOKEN; else process.env.BRAPI_TOKEN = oldTok;

  assert.equal(urls.length, 3, '1 lote + 2 individuais');
  assert.equal(res.body.meta.lote, false);
  assert.equal(Object.keys(res.body.results).sort().join(','), 'PETR4,VALE3');
});

test('handler: upstream fora do ar → 200 com results vazio (nunca derruba o render)', async () => {
  const oldFetch = global.fetch, oldTok = process.env.BRAPI_TOKEN;
  process.env.BRAPI_TOKEN = 'tk';
  global.fetch = async () => { throw new Error('boom'); };
  const res = fakeRes();
  await handler({ query: { symbols: 'PETR4' } }, res);
  global.fetch = oldFetch; if (oldTok == null) delete process.env.BRAPI_TOKEN; else process.env.BRAPI_TOKEN = oldTok;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.results, {});
});

/**
 * Testes da descoberta de ETFs da B3 (api/universe.js).
 * Crítico: ETF e FII terminam ambos em "11" na B3. Classificar pelo sufixo do
 * ticker faria um FII aparecer como ETF (dado falso na tela). Estes testes travam
 * a regra: só o CAMPO DE TIPO da resposta classifica; sem tipo → fora.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEtfItem, selectEtfs, mapItem, inferEtfsFromTypedList } from '../api/universe.js';

test('isEtfItem: aceita pelo campo de tipo (variações de caixa/plural)', () => {
  assert.equal(isEtfItem({ stock: 'BOVA11', type: 'etf' }), true);
  assert.equal(isEtfItem({ stock: 'BOVA11', type: 'ETF' }), true);
  assert.equal(isEtfItem({ stock: 'BOVA11', type: 'ETFs' }), true);
  assert.equal(isEtfItem({ stock: 'BOVA11', assetType: 'ETF' }), true);
});

test('isEtfItem: FII (também termina em 11) NUNCA passa', () => {
  assert.equal(isEtfItem({ stock: 'HGLG11', type: 'fund' }), false);
  assert.equal(isEtfItem({ stock: 'MXRF11', type: 'fii' }), false);
  assert.equal(isEtfItem({ stock: 'KNRI11', type: 'fund', sector: 'Finance' }), false);
});

test('isEtfItem: item sem campo de tipo é ignorado (não adivinha pelo sufixo)', () => {
  assert.equal(isEtfItem({ stock: 'BOVA11' }), false);
  assert.equal(isEtfItem({ stock: 'IVVB11', sector: null }), false);
  assert.equal(isEtfItem(null), false);
  assert.equal(isEtfItem('BOVA11'), false);
});

test('isEtfItem: setor literalmente "ETF" vale só na ausência de campo de tipo', () => {
  assert.equal(isEtfItem({ stock: 'BOVA11', sector: 'ETF' }), true);
  assert.equal(isEtfItem({ stock: 'HGLG11', type: 'fund', sector: 'ETF' }), false);  // tipo manda
  assert.equal(isEtfItem({ stock: 'PETR4', sector: 'Energy Minerals' }), false);
});

test('selectEtfs: separa ETF de ação/FII num payload misto da brapi', () => {
  const payload = [
    { stock: 'PETR4', type: 'stock' },
    { stock: 'HGLG11', type: 'fund' },
    { stock: 'BOVA11', type: 'etf' },
    { stock: 'IVVB11', type: 'ETF' },
    { stock: 'AAPL34', type: 'bdr' },
    { stock: 'XPML11' },                    // sem tipo → fora
  ];
  assert.deepEqual(selectEtfs(payload).map(s => s.stock), ['BOVA11', 'IVVB11']);
  assert.deepEqual(selectEtfs(null), []);
  assert.deepEqual(selectEtfs(undefined), []);
});

test('mapItem: normaliza para o shape do front, com defaults seguros', () => {
  assert.deepEqual(mapItem({ stock: 'BOVA11', name: 'iShares Ibovespa', close: 130.5, change: -0.4 }), {
    tk: 'BOVA11', nm: 'iShares Ibovespa', seg: 'Outros', px: 130.5, var: -0.4, mkt: null, logo: null,
  });
  const m = mapItem({ stock: 'XPTO11', close: null, change: 'x' });
  assert.equal(m.px, 0);       // preço não numérico nunca vira número inventado
  assert.equal(m.var, 0);
  assert.equal(m.nm, 'XPTO11');
});

test('inferEtfsFromTypedList: aceita recorte plausível quando a brapi não manda tipo', () => {
  // exige universo confirmado (>=100 conhecidos) e amostra >=5 — sem isso não dá p/ separar ETF de FII
  const known = new Set(Array.from({ length: 150 }, (_, i) => 'AAA' + i).concat(['PETR4', 'HGLG11']));
  const items = [{ stock: 'BOVA11' }, { stock: 'IVVB11' }, { stock: 'SMAL11' }, { stock: 'GOLD11' }, { stock: 'XINA11' }];
  assert.deepEqual(inferEtfsFromTypedList(items, known).map(s => s.stock),
    ['BOVA11', 'IVVB11', 'SMAL11', 'GOLD11', 'XINA11']);
});

test('inferEtfsFromTypedList: descarta quando o parâmetro type foi IGNORADO (veio o universo todo)', () => {
  const known = new Set(Array.from({ length: 150 }, (_, i) => 'AAA' + i)
    .concat(['PETR4', 'VALE3', 'ITUB4', 'HGLG11', 'MXRF11']));
  const items = [
    { stock: 'PETR4' }, { stock: 'VALE3' }, { stock: 'ITUB4' },
    { stock: 'HGLG11' }, { stock: 'MXRF11' }, { stock: 'BOVA11' },
  ];
  assert.deepEqual(inferEtfsFromTypedList(items, known), []);   // 1 de 6 → abaixo do limiar
});

test('inferEtfsFromTypedList: lista vazia → vazio', () => {
  assert.deepEqual(inferEtfsFromTypedList([], new Set()), []);
});

/* Regressões travadas após auditoria: sem um universo de ações/FIIs confirmado,
   a inferência NÃO pode aceitar FII como ETF (era o furo quando /quote/list?type=fund
   falhava com 429/timeout e `known` ficava vazio). */
test('inferência: sem lista de fundos (known vazio) NÃO infere — FII não vira ETF', () => {
  const fiis = [{ stock: 'HGLG11' }, { stock: 'MXRF11' }, { stock: 'XPML11' }, { stock: 'KNRI11' }, { stock: 'VISC11' }];
  assert.deepEqual(inferEtfsFromTypedList(fiis, new Set()), []);
});

test('inferência: known pequeno (universo truncado) NÃO infere', () => {
  const known = new Set(Array.from({ length: 50 }, (_, i) => 'AAA' + i));
  const itens = [{ stock: 'BOVA11' }, { stock: 'IVVB11' }, { stock: 'SMAL11' }, { stock: 'XFIX11' }, { stock: 'GOLD11' }];
  assert.deepEqual(inferEtfsFromTypedList(itens, known), []);
});

test('inferência: amostra minúscula NÃO infere (1 item passava o limiar trivialmente)', () => {
  const known = new Set(Array.from({ length: 200 }, (_, i) => 'AAA' + i));
  assert.deepEqual(inferEtfsFromTypedList([{ stock: 'HGLG11' }], known), []);
});

test('inferência: com universo confirmado, recorte de ETFs é aceito', () => {
  const known = new Set(Array.from({ length: 200 }, (_, i) => 'AAA' + i).concat(['HGLG11', 'MXRF11']));
  const itens = [{ stock: 'BOVA11' }, { stock: 'IVVB11' }, { stock: 'SMAL11' }, { stock: 'GOLD11' }, { stock: 'XINA11' }];
  assert.equal(inferEtfsFromTypedList(itens, known).length, 5);
});

test('inferência: FIIs conhecidos derrubam o limiar e o payload é rejeitado', () => {
  const known = new Set(Array.from({ length: 200 }, (_, i) => 'AAA' + i).concat(['HGLG11', 'MXRF11', 'XPML11', 'KNRI11']));
  const itens = [{ stock: 'HGLG11' }, { stock: 'MXRF11' }, { stock: 'XPML11' }, { stock: 'KNRI11' }, { stock: 'BOVA11' }];
  assert.deepEqual(inferEtfsFromTypedList(itens, known), []);
});

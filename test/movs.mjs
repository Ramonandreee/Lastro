/**
 * Testes do Livro de Movimentações (vendor/movs.js) — redutor PURO de estado.
 * Módulo UMD carregado via require() (createRequire) no runner node:test.
 * Cobre: compra neutra em caixa (Fase 1), venda (soma produto + realizado),
 * provento (soma caixa), PM ponderado e o caso migração-só-compra (caixa=0).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Movs = require('../vendor/movs.js');
const M = require('../vendor/money.js');

test('compra: soma cotas, PM ponderado e caixa NEUTRO (Fase 1)', () => {
  const MOVS = [
    { id: 'a', type: 'compra', tk: 'HGLG11', cotas: 100, preco: 140.00, date: '2025-01-10' },
    { id: 'b', type: 'compra', tk: 'HGLG11', cotas: 50,  preco: 160.00, date: '2025-02-10' },
  ];
  const st = Movs.deriveState(MOVS);
  const p = st.posByTk.HGLG11;
  assert.equal(p.cotas, 150);
  // PM ponderado = (100*140 + 50*160)/150 = 22000/150 = 146,6667
  assert.equal(Math.round(p.pm * 100) / 100, 146.67);
  // custo nativo em centavos = 14000,00 + 8000,00 = 2.200.000 ¢
  assert.equal(p.custoCentsNat, 2200000);
  // Fase 1: compra NÃO mexe no caixa
  assert.equal(st.caixaCents, 0);
});

test('venda: baixa cotas pelo PM, SOMA produto líquido ao caixa e gera realizado', () => {
  const MOVS = [
    { id: 'a', type: 'compra', tk: 'PETR4', cotas: 100, preco: 30.00, date: '2025-01-01' },
    { id: 'b', type: 'venda',  tk: 'PETR4', cotas: 40,  preco: 35.00, date: '2025-03-01' },
  ];
  const st = Movs.deriveState(MOVS);
  const p = st.posByTk.PETR4;
  assert.equal(p.cotas, 60);
  assert.equal(Math.round(p.pm * 100) / 100, 30.00);   // PM não muda na venda
  // caixa: compra neutra (0) + venda soma 40*35 = 1400,00 = 140.000 ¢
  assert.equal(st.caixaCents, 140000);
  // realizado 2025 = 40*(35-30) = 200,00 = 20.000 ¢
  assert.equal(st.realizadoCents['2025'].ganhoCents, 20000);
});

test('venda total: zera a posição e custo, caixa recebe o produto', () => {
  const MOVS = [
    { id: 'a', type: 'compra', tk: 'VALE3', cotas: 100, preco: 60.00, date: '2025-01-01' },
    { id: 'b', type: 'venda',  tk: 'VALE3', cotas: 100, preco: 70.00, date: '2025-06-01' },
  ];
  const st = Movs.deriveState(MOVS);
  assert.equal(st.posByTk.VALE3.cotas, 0);
  assert.equal(st.posByTk.VALE3.custoCentsNat, 0);
  assert.equal(st.caixaCents, 700000);   // 100*70 = 7000,00
  assert.equal(st.realizadoCents['2025'].ganhoCents, 100000);   // 100*(70-60) = 1000,00
});

test('provento: posição e PM intactos; só entra caixa', () => {
  const MOVS = [
    { id: 'a', type: 'compra',   tk: 'MXRF11', cotas: 1000, preco: 10.00, date: '2025-01-01' },
    { id: 'b', type: 'provento', tk: 'MXRF11', valor: 100.00,             date: '2025-02-15' },
  ];
  const st = Movs.deriveState(MOVS);
  assert.equal(st.posByTk.MXRF11.cotas, 1000);
  assert.equal(Math.round(st.posByTk.MXRF11.pm * 100) / 100, 10.00);
  assert.equal(st.caixaCents, 10000);   // provento 100,00 = 10.000 ¢
});

test('compra→venda→provento: sequência completa confere cotas, PM, caixa e realizado', () => {
  const MOVS = [
    { id: 'a', type: 'compra',   tk: 'ITUB4', cotas: 200, preco: 25.00, date: '2025-01-01' },
    { id: 'b', type: 'compra',   tk: 'ITUB4', cotas: 100, preco: 31.00, date: '2025-02-01' },
    { id: 'c', type: 'venda',    tk: 'ITUB4', cotas: 120, preco: 30.00, date: '2025-03-01' },
    { id: 'd', type: 'provento', tk: 'ITUB4', valor: 45.00,            date: '2025-04-01' },
  ];
  const st = Movs.deriveState(MOVS);
  const p = st.posByTk.ITUB4;
  // PM = (200*25 + 100*31)/300 = 8100/300 = 27,00
  assert.equal(Math.round(p.pm * 100) / 100, 27.00);
  assert.equal(p.cotas, 180);   // 300 - 120
  // caixa = venda(120*30=3600,00) + provento(45,00) = 3645,00 = 364.500 ¢
  assert.equal(st.caixaCents, 364500);
  // realizado = 120*(30-27) = 360,00 = 36.000 ¢
  assert.equal(st.realizadoCents['2025'].ganhoCents, 36000);
});

test('aporte soma / resgate subtrai caixa', () => {
  const MOVS = [
    { id: 'a', type: 'aporte',  valor: 500.00, date: '2025-01-01' },
    { id: 'b', type: 'resgate', valor: 200.00, date: '2025-02-01' },
  ];
  const st = Movs.deriveState(MOVS);
  assert.equal(st.caixaCents, 30000);   // 500 - 200 = 300,00
});

test('realizado por ANO: vendas separadas por exercício', () => {
  const MOVS = [
    { id: 'a', type: 'compra', tk: 'BBAS3', cotas: 100, preco: 20.00, date: '2024-01-01' },
    { id: 'b', type: 'venda',  tk: 'BBAS3', cotas: 30,  preco: 25.00, date: '2024-06-01' },
    { id: 'c', type: 'venda',  tk: 'BBAS3', cotas: 30,  preco: 28.00, date: '2025-06-01' },
  ];
  const st = Movs.deriveState(MOVS);
  assert.equal(st.realizadoCents['2024'].ganhoCents, 15000);   // 30*(25-20)=150,00
  assert.equal(st.realizadoCents['2025'].ganhoCents, 24000);   // 30*(28-20)=240,00
});

test('MIGRAÇÃO só-compra: caixa=0 e rebuildLots reproduz lotes idênticos (invariante de ouro)', () => {
  const CARTEIRA = [
    { id: 'l1', tk: 'HGLG11', cotas: 120, pm: 142.10, date: '2025-01-05' },
    { id: 'l2', tk: 'KNCR11', cotas: 130, pm: 101.50, date: '2025-02-05' },
    { id: 'l3', tk: 'VISC11', cotas: 105, pm: 99.80,  date: '2025-03-05' },
  ];
  const MOVS = CARTEIRA.map(l => ({ id: l.id, type: 'compra', tk: l.tk, cotas: l.cotas, preco: l.pm, date: l.date }));
  const st = Movs.deriveState(MOVS);
  assert.equal(st.caixaCents, 0);   // só-compra → caixa zero, patrimônio inalterado
  const lots = Movs.rebuildLots(MOVS);
  assert.equal(lots.length, CARTEIRA.length);
  CARTEIRA.forEach(orig => {
    const got = lots.find(x => x.id === orig.id);
    assert.ok(got, 'lote ' + orig.id + ' preservado');
    assert.equal(got.tk, orig.tk);
    assert.equal(got.cotas, orig.cotas);
    assert.equal(got.pm, orig.pm);     // PM === preco EXATO (sem ida-e-volta por centavos)
    assert.equal(got.date, orig.date);
  });
});

test('fx USD: caixa de venda dolarizada é convertido a BRL', () => {
  const MOVS = [
    { id: 'a', type: 'compra', tk: 'AAPL', cur: 'usd', cotas: 10, preco: 100.00, date: '2025-01-01' },
    { id: 'b', type: 'venda',  tk: 'AAPL', cur: 'usd', cotas: 10, preco: 120.00, date: '2025-02-01' },
  ];
  const st = Movs.deriveState(MOVS, '9999-12-31', { fx: (cur) => cur === 'usd' ? 5.00 : 1 });
  // venda 10*120 = US$ 1200 → R$ 6000,00 = 600.000 ¢
  assert.equal(st.caixaCents, 600000);
  // realizado 10*(120-100)=US$200 → R$ 1000,00 = 100.000 ¢
  assert.equal(st.realizadoCents['2025'].ganhoCents, 100000);
});

test('venda PARCIAL: balanço e realizado batem centavo a centavo (achado 4)', () => {
  // PM ponderado fracionário para estressar arredondamento: 3 cotas a 10,333 = custo 30,999
  const MOVS = [
    { id: 'a', type: 'compra', tk: 'XPTO3', cotas: 3, preco: 10.333, date: '2025-01-01' },
    { id: 'b', type: 'venda',  tk: 'XPTO3', cotas: 1, preco: 20.00,   date: '2025-02-01' },
  ];
  const custoAntes = M.positionCents(3, 10.333);            // custo total em centavos (3100)
  const produto = M.positionCents(1, 20.00);               // produto da venda (2000)
  const st = Movs.deriveState(MOVS);
  const p = st.posByTk.XPTO3;
  const realizado = st.realizadoCents['2025'].ganhoCents;
  // INVARIANTE do achado 4: o custo RETIRADO do balanço == a base usada no realizado
  // (custoBaixaCents), sem divergência de 1¢. custo baixado = custoAntes − custoRestante = produto − realizado.
  assert.equal(custoAntes - p.custoCentsNat, produto - realizado);
  assert.equal(p.cotas, 2);
});

/**
 * Testes das derivações de carteira de instituição (vendor/instport.js).
 * O contrato mais importante aqui é NEGATIVO: nada pode produzir número quando
 * o dado real não existe. Módulo UMD via require().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const IP = require('../vendor/instport.js');

// carteira-exemplo GENÉRICA (tickers fictícios de teste, nunca usada em produto)
const P = {
  instituicao: 'Instituição X', nome: 'Carteira Teste', competencia: '2026-08',
  publicadoEm: '2026-08-01', fonteUrl: 'https://exemplo.com/relatorio',
  itens: [{ tk: 'aaa3', peso: 50 }, { tk: 'BBB3', peso: 30 }, { tk: 'CCC11', peso: 20 }],
};

test('itens normaliza ticker e descarta peso inválido', () => {
  const its = IP.itens({ itens: [{ tk: 'aaa3', peso: 50 }, { tk: 'BBB3', peso: 0 }, { tk: '', peso: 10 }, null] });
  assert.deepEqual(its, [{ tk: 'AAA3', peso: 50 }]);
});

test('carteira completa passa na validação', () => {
  assert.deepEqual(IP.validar(P), []);
});

test('validação exige fonteUrl (link para o relatório original)', () => {
  const probs = IP.validar({ ...P, fonteUrl: '' });
  assert.ok(probs.some(p => p.includes('fonteUrl')));
});

test('validação pega soma de pesos fora de 100%', () => {
  const probs = IP.validar({ ...P, itens: [{ tk: 'AAA3', peso: 40 }, { tk: 'BBB3', peso: 30 }] });
  assert.ok(probs.some(p => p.includes('soma dos pesos')));
});

test('validação tolera arredondamento de 1 casa do relatório', () => {
  const p = { ...P, itens: [{ tk: 'AAA3', peso: 33.3 }, { tk: 'BBB3', peso: 33.3 }, { tk: 'CCC11', peso: 33.3 }] };
  assert.deepEqual(IP.validar(p), []);   // soma 99.9
});

test('validação pega ticker repetido', () => {
  const probs = IP.validar({ ...P, itens: [{ tk: 'AAA3', peso: 50 }, { tk: 'aaa3', peso: 50 }] });
  assert.ok(probs.some(p => p.includes('repetido')));
});

test('porSetor agrega e ordena por peso', () => {
  const setor = tk => ({ AAA3: 'Financeiro', BBB3: 'Energia', CCC11: 'Financeiro' })[tk] || null;
  assert.deepEqual(IP.porSetor(P, setor), [
    { setor: 'Financeiro', peso: 70 }, { setor: 'Energia', peso: 30 },
  ]);
});

test('ativo sem setor conhecido vira "Não classificado" (não é chutado)', () => {
  const s = IP.porSetor(P, () => null);
  assert.deepEqual(s, [{ setor: 'Não classificado', peso: 100 }]);
});

test('concentracao calcula HHI, efetivos e top-N', () => {
  const c = IP.concentracao(P, 2);
  assert.equal(c.ativos, 3);
  assert.equal(c.hhi, 50 * 50 + 30 * 30 + 20 * 20);   // 3800
  assert.ok(Math.abs(c.efetivos - 10000 / 3800) < 1e-9);
  assert.equal(c.topPeso, 80);
  assert.equal(c.maior.tk, 'AAA3');
});

test('ponderado devolve média e cobertura quando falta indicador', () => {
  const r = IP.ponderado(P, tk => (tk === 'CCC11' ? null : 10));
  assert.equal(r.valor, 10);
  assert.equal(r.cobertura, 80);           // só 80% do peso tinha número
  assert.deepEqual(r.faltando, ['CCC11']);
});

test('ponderado sem nenhum indicador → valor null (nunca 0)', () => {
  const r = IP.ponderado(P, () => null);
  assert.equal(r.valor, null);
  assert.equal(r.cobertura, 0);
});

test('desempenho usa fechamentos reais das duas pontas', () => {
  const px = { AAA3: { a: 10, b: 11 }, BBB3: { a: 20, b: 20 }, CCC11: { a: 5, b: 4 } };
  const r = IP.desempenho(P, 'a', 'b', (tk, d) => px[tk][d]);
  assert.equal(r.ok, true);
  // 50%*+10% + 30%*0% + 20%*-20% = 5 - 4 = +1%
  assert.ok(Math.abs(r.ret - 1) < 1e-9);
});

test('desempenho é TUDO OU NADA: falta um fechamento → ok:false, sem número', () => {
  const px = { AAA3: { a: 10, b: 11 }, BBB3: { a: 20, b: 20 }, CCC11: { a: null, b: 4 } };
  const r = IP.desempenho(P, 'a', 'b', (tk, d) => px[tk][d]);
  assert.equal(r.ok, false);
  assert.equal(r.ret, undefined);
  assert.deepEqual(r.faltando, ['CCC11']);
});

test('desempenho recusa preço inicial zero (divisão inválida)', () => {
  const r = IP.desempenho({ itens: [{ tk: 'AAA3', peso: 100 }] }, 'a', 'b', () => 0);
  assert.equal(r.ok, false);
});

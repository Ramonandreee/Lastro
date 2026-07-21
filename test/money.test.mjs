/**
 * Testes do módulo monetário em centavos (vendor/money.js) — precisão de extrato.
 * Módulo UMD: carregado via require() (createRequire) no runner de testes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../vendor/money.js');

test('toCents/fromCents: ida e volta sem perda', () => {
  assert.equal(M.toCents(40.15), 4015);
  assert.equal(M.toCents(0.1), 10);
  assert.equal(M.fromCents(4015), 40.15);
  assert.equal(M.fromCents(M.toCents(1234.56)), 1234.56);
});

test('toCents: arredonda ao centavo (meio para cima, simétrico)', () => {
  assert.equal(M.toCents(40.155), 4016);    // .5 → cima
  assert.equal(M.toCents(-40.155), -4016);  // simétrico p/ negativos
  assert.equal(M.toCents(40.154), 4015);
});

test('SEM DRIFT: 0,1 + 0,2 = 0,30 exato (float falha)', () => {
  // em float: 0.1 + 0.2 === 0.30000000000000004
  const cents = M.sumCents([M.toCents(0.1), M.toCents(0.2)]);
  assert.equal(cents, 30);
  assert.equal(M.fromCents(cents), 0.3);
});

test('SEM DRIFT: somar 3 posições de 0,10 = 0,30 (não 0,30000000000000004)', () => {
  const total = M.sumCents([M.toCents(0.1), M.toCents(0.1), M.toCents(0.1)]);
  assert.equal(M.fromCents(total), 0.3);
});

test('positionCents: preço com 3 casas — arredonda 1x no valor da posição', () => {
  // 100 cotas × R$ 40,153 = R$ 4.015,30 → 401530 centavos (mantém a 3ª casa antes do round)
  assert.equal(M.positionCents(100, 40.153), 401530);
  // cotas fracionárias (cripto): 0,5 × R$ 319.807,00 = R$ 159.903,50
  assert.equal(M.positionCents(0.5, 319807), 15990350);
});

test('carteira exemplo (BBSE3): custo/valor/lucro em centavos', () => {
  const cotas = 1000, pm = 40.05, px = 41.05;
  const custo = M.positionCents(cotas, pm);   // 4.005.000 ¢
  const valor = M.positionCents(cotas, px);   // 4.105.000 ¢
  assert.equal(custo, 4005000);
  assert.equal(valor, 4105000);
  const lucro = valor - custo;                 // exato
  assert.equal(lucro, 100000);                 // R$ 1.000,00
  assert.equal(M.fromCents(lucro), 1000);
  assert.equal(Math.round(M.pctCents(lucro, custo) * 100) / 100, 2.5);   // +2,50%
});

test('convertCents: USD¢ → BRL¢ arredonda 1x', () => {
  // US$ 100,00 = 10000¢ USD; câmbio 5,18 → R$ 518,00 = 51800¢ BRL
  assert.equal(M.convertCents(10000, 5.18), 51800);
});

test('agregado exato: soma de N posições sem drift acumulado', () => {
  // 50 posições de R$ 33,33 → R$ 1.666,50 exato
  const centsList = [];
  for (let i = 0; i < 50; i++) centsList.push(M.positionCents(1, 33.33));
  const total = M.sumCents(centsList);
  assert.equal(total, 166650);
  assert.equal(M.fromCents(total), 1666.5);
});

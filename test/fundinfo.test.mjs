/**
 * Testes do matcher/parse da CVM (api/fundinfo.js).
 * Crítico: um match errado aplica patrimônio/taxa ao ATIVO ERRADO (dado financeiro
 * incorreto na tela). parseNum errado = patrimônio errado. Rode: `node --test test/`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseNum, tokens, matchOne } from '../api/fundinfo.js';

test('normalize: minúsculas, sem acento, só alfanumérico', () => {
  assert.equal(normalize('São Paulo Ltda.'), 'sao paulo ltda');
  assert.equal(normalize('CSHG   Logística'), 'cshg logistica');
  assert.equal(normalize(null), '');
});

test('parseNum: formatos numéricos da CVM', () => {
  assert.equal(parseNum('1.234,56'), 1234.56);   // milhar + decimal pt-BR
  assert.equal(parseNum('0,05'), 0.05);           // só vírgula → decimal
  assert.equal(parseNum('1234.56'), 1234.56);     // só ponto → decimal
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('abc'), null);
  assert.equal(parseNum(null), null);
});

test('tokens: descarta stopwords e tokens curtos', () => {
  assert.deepEqual(tokens('FII CSHG Logística'), ['cshg', 'logistica']);
  assert.deepEqual(tokens('Fundo de Investimento Imobiliário'), []);  // tudo stopword
});

test('matchOne: casa único com token distintivo (≥4)', () => {
  const fundos = [
    { nome: 'CSHG Logística FII', toks: tokens('CSHG Logística FII'), taxaAdm: 0.8, patrimonio: 100 },
    { nome: 'XP Malls FII', toks: tokens('XP Malls FII'), taxaAdm: 0.5, patrimonio: 200 },
  ];
  const m = matchOne(fundos, 'CSHG Logística');
  assert.ok(m && m.nome === 'CSHG Logística FII');
});

test('matchOne: NÃO casa quando é ambíguo (unicidade)', () => {
  const fundos = [
    { nome: 'Kinea Renda Imobiliária', toks: tokens('Kinea Renda Imobiliária') },
    { nome: 'Kinea Renda Corporativa', toks: tokens('Kinea Renda') },  // ambos contêm "renda"/"kinea"
  ];
  // pedido genérico "Kinea Renda" casa os dois → deve retornar null (conservador)
  assert.equal(matchOne(fundos, 'Kinea Renda'), null);
});

test('matchOne: NÃO casa sem token distintivo (todos < 4)', () => {
  const fundos = [{ nome: 'ABC XYZ', toks: tokens('ABC XYZ') }];
  assert.equal(matchOne(fundos, 'abc'), null);
});

test('matchOne: sem correspondência retorna null', () => {
  const fundos = [{ nome: 'CSHG Logística', toks: tokens('CSHG Logística') }];
  assert.equal(matchOne(fundos, 'Vinci Shopping'), null);
});

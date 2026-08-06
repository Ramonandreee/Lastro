/**
 * Testes do casamento manchete→ativo (vendor/newsmatch.js).
 * O contrato mais importante aqui é NEGATIVO: nenhuma manchete pode cair na
 * página do ativo errado. Por isso metade dos testes é de FALSO POSITIVO.
 * Módulo UMD via require().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NM = require('../vendor/newsmatch.js');

/* ── normalização ───────────────────────────────────────── */
test('norm remove acento, caixa e pontuação', () => {
  assert.equal(NM.norm('Raia Drogasil (RD Saúde) — lucro!'), 'raia drogasil rd saude lucro');
  assert.equal(NM.norm(null), '');
});

/* ── ticker literal ─────────────────────────────────────── */
test('tickersInText acha TODOS os tickers do título, sem repetir', () => {
  assert.deepEqual(
    NM.tickersInText('PETR4 e VALE3 sobem; PETR4 lidera'),
    ['PETR4', 'VALE3']
  );
});

test('tickersInText não inventa ticker em palavra comum', () => {
  assert.deepEqual(NM.tickersInText('Ibovespa fecha em alta com juros'), []);
});

/* ── casamento por nome (o que resolve o problema relatado) ── */
test('RADL3 casa por nome comercial, sem ticker no título', () => {
  assert.ok(NM.matchesTicker('Raia Drogasil abre 300 lojas e acelera expansão', 'RADL3'));
  assert.ok(NM.matchesTicker('RD Saúde tem lucro de R$ 300 milhões no trimestre', 'RADL3'));
});

test('DASA3 e TEND3 casam por nome', () => {
  assert.ok(NM.matchesTicker('Dasa conclui reestruturação de dívida', 'DASA3'));
  assert.ok(NM.matchesTicker('Tenda dispara após lucro recorde no trimestre', 'TEND3'));
});

test('nome casa com qualquer classe da MESMA empresa', () => {
  assert.ok(NM.matchesTicker('Petrobras aprova dividendos extraordinários', 'PETR3'));
  assert.ok(NM.matchesTicker('Petrobras aprova dividendos extraordinários', 'PETR4'));
});

test('ticker literal de outra classe também casa (PETR3 na página de PETR4)', () => {
  assert.ok(NM.matchesTicker('PETR3 sobe 3% no pregão', 'PETR4'));
});

/* ── FALSO POSITIVO: o teste que importa ────────────────── */
test('empresa diferente NÃO casa', () => {
  assert.equal(NM.matchesTicker('Raia Drogasil abre 300 lojas', 'PETR4'), false);
  assert.equal(NM.matchesTicker('Petrobras aprova dividendos', 'RADL3'), false);
});

test('palavra comum "vale" (verbo/substantivo) não vira VALE3', () => {
  assert.equal(NM.matchesTicker('Vale a pena investir em renda fixa agora?', 'VALE3'), false);
  assert.equal(NM.matchesTicker('Não vale o risco, diz gestor sobre small caps', 'VALE3'), false);
});

test('"Vale" com contexto de mineração casa', () => {
  assert.ok(NM.matchesTicker('Vale eleva produção de minério de ferro no trimestre', 'VALE3'));
  assert.ok(NM.matchesTicker('Vale S.A. anuncia recompra de ações', 'VALE3'));
});

test('"tenda" fora do contexto de construção não vira TEND3', () => {
  assert.equal(NM.matchesTicker('Feira monta tenda para receber investidores', 'TEND3'), false);
  assert.equal(NM.matchesTicker('Tenda Atacado é vendida pelo grupo controlador', 'TEND3'), false);
});

test('"rumo" como preposição não vira RAIL3', () => {
  assert.equal(NM.matchesTicker('Ibovespa segue rumo aos 140 mil pontos', 'RAIL3'), false);
  assert.ok(NM.matchesTicker('Rumo amplia capacidade da malha norte de grãos', 'RAIL3'));
});

test('"azul" e "gol" só casam com contexto aéreo', () => {
  assert.equal(NM.matchesTicker('Faixa azul do gráfico mostra a média móvel', 'AZUL4'), false);
  assert.equal(NM.matchesTicker('Gol de placa: fundo bate o CDI em 2025', 'GOLL4'), false);
  assert.ok(NM.matchesTicker('Azul negocia dívida com arrendadores de aeronaves na aviação', 'AZUL4'));
});

test('Banco Central do Brasil não vira BBAS3', () => {
  assert.equal(NM.matchesTicker('Banco Central do Brasil mantém a Selic em 15%', 'BBAS3'), false);
  assert.ok(NM.matchesTicker('Banco do Brasil tem lucro de R$ 9 bi', 'BBAS3'));
});

test('CSN Mineração não vira CSNA3 (e vira CMIN3)', () => {
  assert.equal(NM.matchesTicker('CSN Mineração eleva produção anual', 'CSNA3'), false);
  assert.ok(NM.matchesTicker('CSN Mineração eleva produção anual', 'CMIN3'));
});

test('Metalúrgica Gerdau não vira GGBR4', () => {
  assert.equal(NM.matchesTicker('Metalúrgica Gerdau aprova JCP', 'GGBR4'), false);
  assert.ok(NM.matchesTicker('Metalúrgica Gerdau aprova JCP', 'GOAU4'));
  assert.ok(NM.matchesTicker('Gerdau investe em nova usina', 'GGBR4'));
});

test('Guiné Equatorial não vira EQTL3', () => {
  assert.equal(NM.matchesTicker('Petróleo: Guiné Equatorial amplia produção', 'EQTL3'), false);
});

test('"B3" (a bolsa) não é mapeada — ambiguidade insanável', () => {
  assert.equal(NM.matchesTicker('Ações sobem na B3 nesta segunda', 'B3SA3'), false);
  assert.equal(NM.MAP.B3SA, undefined);
});

test('nome só casa como palavra inteira, nunca como pedaço', () => {
  assert.equal(NM.matchesTicker('Weguer é o novo diretor da empresa', 'WEGE3'), false);
  assert.equal(NM.matchesTicker('Jbssat lança serviço', 'JBSS3'), false);
});

/* ── marcação para o coletor ────────────────────────────── */
test('matchTickers junta literal + nome, sem duplicar a mesma empresa', () => {
  assert.deepEqual(NM.matchTickers('PETR4: Petrobras aprova dividendos'), ['PETR4']);
  assert.deepEqual(NM.matchTickers('Petrobras e Vale sobem com minério de ferro').sort(), ['PETR4', 'VALE3']);
});

test('primaryTicker mantém compatibilidade com o campo ticker', () => {
  assert.equal(NM.primaryTicker('HGBS11: fundo compra participação em shopping'), 'HGBS11');
  assert.equal(NM.primaryTicker('Raia Drogasil abre 300 lojas'), 'RADL3');
  assert.equal(NM.primaryTicker('Selic sobe e mercado reage'), null);
});

test('FII continua casando pelo ticker do título', () => {
  assert.ok(NM.matchesTicker('HGLG11 anuncia rendimento de R$ 1,10', 'HGLG11'));
  assert.equal(NM.matchesTicker('HGLG11 anuncia rendimento de R$ 1,10', 'XPML11'), false);
});

/* ── portão do learn() ──────────────────────────────────── */
test('cleanName aceita nome próprio e recusa substantivo comum', () => {
  assert.equal(NM.cleanName('Localiza S.A.'), 'localiza');
  assert.equal(NM.cleanName('Lojas Renner S/A'), 'lojas renner');
  assert.equal(NM.cleanName('Vale S.A.'), '');            // 1 palavra comum
  assert.equal(NM.cleanName('Construtora Tenda'), 'construtora tenda');
  assert.equal(NM.cleanName('Cia Brasileira de Participações'), '');
  assert.equal(NM.cleanName('WEG'), '');                  // 1 palavra curta demais p/ o portão
  assert.equal(NM.cleanName(''), '');
});

test('learn nunca sobrescreve o mapa curado e ignora ticker inválido', () => {
  const before = NM.MAP.PETR;
  const n = NM.learn([
    { tk: 'PETR4', nm: 'Nome Errado Qualquer' },   // curado tem precedência
    { tk: 'XX', nm: 'Alguma Coisa' },              // ticker inválido
    { tk: 'ZZZZ3', nm: 'Energia' },                // substantivo comum
    { tk: 'YYYY3', nm: 'Companhia Zeta Delta' },   // entra
  ]);
  assert.equal(n, 1);
  assert.equal(NM.MAP.PETR, before);
  assert.equal(NM.MAP.ZZZZ, undefined);
  assert.ok(NM.matchesTicker('Zeta Delta anuncia aquisição', 'YYYY3'));
  assert.equal(NM.matchesTicker('Zeta anuncia aquisição', 'YYYY3'), false);
  delete NM.MAP.YYYY;   // não vaza para os outros testes
});

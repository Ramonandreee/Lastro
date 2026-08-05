/**
 * LastroInstPort — derivações PURAS de uma carteira publicada por instituição.
 * ────────────────────────────────────────────────────────────────────
 * REGRA INVIOLÁVEL DESTE MÓDULO: o ÚNICO dado de origem externa é a COMPOSIÇÃO
 * publicada pela instituição — { instituicao, nome, competencia, publicadoEm,
 * fonteUrl, itens:[{tk, peso}] }. Tudo o mais (setor, concentração, indicadores
 * ponderados, desempenho) é DERIVADO de dado real que o app já tem. Nada aqui
 * inventa ativo, peso, rentabilidade ou cotação.
 *
 * Por isso o módulo é conservador por construção:
 *  - cobertura sempre acompanha o número (nunca um DY "da carteira" calculado
 *    sobre 40% dela sem dizer);
 *  - desempenho só existe se HOUVER fechamento real de TODOS os ativos nas duas
 *    pontas — senão devolve { ok:false, faltando:[...] }, nunca um número parcial.
 *
 * Puro: não lê localStorage, DOM, rede nem relógio.
 *
 * Dupla vida (UMD): `window.LastroInstPort` no browser; `require()` no Node (testes).
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.LastroInstPort = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TOL = 0.51;   // tolerância (p.p.) na soma dos pesos — relatórios arredondam para 1 casa

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** Itens válidos e normalizados ({tk maiúsculo, peso number>0}), na ordem recebida. */
  function itens(p) {
    var arr = (p && Array.isArray(p.itens)) ? p.itens : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i]; if (!it) continue;
      var tk = typeof it.tk === 'string' ? it.tk.trim().toUpperCase() : '';
      var peso = num(it.peso);
      if (!tk || peso === null || peso <= 0) continue;
      out.push({ tk: tk, peso: peso });
    }
    return out;
  }

  function somaPesos(p) {
    return itens(p).reduce(function (s, it) { return s + it.peso; }, 0);
  }

  /**
   * Problemas que impedem PUBLICAR a carteira (lista vazia = pode exibir).
   * É o portão: carteira sem fonte/data ou com peso que não fecha não vai ao ar.
   */
  function validar(p) {
    var probs = [];
    if (!p || typeof p !== 'object') return ['carteira ausente'];
    if (!p.instituicao) probs.push('instituição ausente');
    if (!p.nome) probs.push('nome ausente');
    if (!p.competencia) probs.push('competência ausente');
    if (!p.publicadoEm) probs.push('data de publicação ausente');
    if (!p.fonteUrl) probs.push('fonteUrl ausente (link para o relatório original é obrigatório)');
    var its = itens(p);
    if (!its.length) { probs.push('sem ativos'); return probs; }
    var vistos = Object.create(null), dup = [];
    for (var i = 0; i < its.length; i++) {
      if (vistos[its[i].tk]) dup.push(its[i].tk); else vistos[its[i].tk] = 1;
    }
    if (dup.length) probs.push('ticker repetido: ' + dup.join(', '));
    var soma = its.reduce(function (s, it) { return s + it.peso; }, 0);
    if (Math.abs(soma - 100) > TOL) probs.push('soma dos pesos = ' + soma.toFixed(2) + '% (esperado 100%)');
    return probs;
  }

  /**
   * Peso por setor. `setorDe(tk)` vem do app (ASSET_CLASS/assetLookup) — dado real.
   * Ativo sem setor conhecido cai em 'Não classificado' (nunca é chutado).
   */
  function porSetor(p, setorDe) {
    var mapa = Object.create(null);
    itens(p).forEach(function (it) {
      var s = (typeof setorDe === 'function' ? setorDe(it.tk) : null) || 'Não classificado';
      mapa[s] = (mapa[s] || 0) + it.peso;
    });
    return Object.keys(mapa)
      .map(function (s) { return { setor: s, peso: mapa[s] }; })
      .sort(function (a, b) { return b.peso - a.peso || (a.setor < b.setor ? -1 : 1); });
  }

  /**
   * Concentração: HHI (0–10000 na escala de pesos %), nº efetivo de ativos (1/ΣwÂ²)
   * e peso das N maiores posições. Métricas padrão — nada arbitrado.
   */
  function concentracao(p, topN) {
    var its = itens(p);
    if (!its.length) return null;
    var hhi = its.reduce(function (s, it) { return s + it.peso * it.peso; }, 0);
    var n = topN > 0 ? topN : 5;
    var top = its.slice().sort(function (a, b) { return b.peso - a.peso; }).slice(0, n);
    return {
      hhi: hhi,
      efetivos: hhi > 0 ? 10000 / hhi : 0,
      ativos: its.length,
      topN: n,
      topPeso: top.reduce(function (s, it) { return s + it.peso; }, 0),
      maior: top[0] || null,
    };
  }

  /**
   * Média ponderada de um indicador (DY, P/L…) sobre os ativos que TÊM o número.
   * `valorDe(tk)` devolve number ou null. Retorna também a COBERTURA (% do peso
   * da carteira efetivamente considerado) para a tela poder dizer a verdade.
   */
  function ponderado(p, valorDe) {
    var pesoOk = 0, acc = 0, faltando = [];
    itens(p).forEach(function (it) {
      var v = typeof valorDe === 'function' ? num(valorDe(it.tk)) : null;
      if (v === null) { faltando.push(it.tk); return; }
      pesoOk += it.peso; acc += it.peso * v;
    });
    if (pesoOk <= 0) return { valor: null, cobertura: 0, faltando: faltando };
    var total = somaPesos(p);
    return {
      valor: acc / pesoOk,
      cobertura: total > 0 ? (pesoOk / total) * 100 : 0,
      faltando: faltando,
    };
  }

  /**
   * Desempenho buy-and-hold da composição entre duas datas, com fechamentos REAIS.
   * `fechamentoEm(tk, data)` devolve number ou null (o app usa HIST_CLOSE/closeOn).
   *
   * TUDO OU NADA: se faltar fechamento de qualquer ativo em qualquer das pontas,
   * devolve { ok:false, faltando:[...] } — jamais um retorno "quase certo".
   */
  function desempenho(p, de, ate, fechamentoEm) {
    var its = itens(p);
    if (!its.length || !de || !ate || typeof fechamentoEm !== 'function') {
      return { ok: false, faltando: its.map(function (i) { return i.tk; }) };
    }
    var faltando = [], acc = 0, pesoTotal = 0;
    for (var i = 0; i < its.length; i++) {
      var it = its[i];
      var p0 = num(fechamentoEm(it.tk, de)), p1 = num(fechamentoEm(it.tk, ate));
      if (p0 === null || p1 === null || p0 <= 0) { faltando.push(it.tk); continue; }
      acc += it.peso * (p1 / p0 - 1);
      pesoTotal += it.peso;
    }
    if (faltando.length || pesoTotal <= 0) return { ok: false, faltando: faltando };
    return { ok: true, ret: (acc / pesoTotal) * 100, de: de, ate: ate };
  }

  return {
    itens: itens,
    somaPesos: somaPesos,
    validar: validar,
    porSetor: porSetor,
    concentracao: concentracao,
    ponderado: ponderado,
    desempenho: desempenho,
    TOL: TOL,
  };
});

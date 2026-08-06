/**
 * LastroNewsMatch — casamento PURO entre manchete e ativo da B3.
 * ────────────────────────────────────────────────────────────────────
 * Problema que este módulo resolve: a manchete real quase nunca traz o ticker
 * das AÇÕES ("Raia Drogasil abre 300 lojas", "Tenda dispara com resultado"),
 * só os FIIs seguem a convenção "HGBS11: ...". Antes disso, a única ligação
 * notícia→ativo era o ticker literal no título — por isso a página de RADL3
 * dizia "Sem notícias recentes" mesmo com notícia da empresa no feed.
 *
 * REGRA INVIOLÁVEL: FALSO POSITIVO É PIOR QUE FALSO NEGATIVO.
 * Mostrar notícia de outra empresa na página de um ativo é erro grave; não
 * mostrar nada é apenas uma lacuna. Por isso:
 *  - o mapa nome→ticker é CURADO à mão (não gerado de razão social);
 *  - casamento por PALAVRA INTEIRA (o texto é tokenizado; nada de substring);
 *  - nome que é substantivo comum ("Vale", "Tenda", "Rumo", "Azul", "Gol",
 *    "Vivo", "Light", "Direcional") só casa COM CONTEXTO setorial no título;
 *  - nome ambíguo sem contexto confiável (ex.: "B3", "Vamos", "Soma") NÃO é
 *    mapeado — fica de fora de propósito;
 *  - vetos (`n`) desfazem colisões conhecidas ("CSN Mineração" ≠ CSN).
 *
 * Classes múltiplas (PETR3/PETR4): o mapa é indexado pela RAIZ de 4 letras, então
 * o nome casa com QUALQUER classe da empresa na consulta (`matchesTicker`), e a
 * marcação gravada pelo coletor usa a classe mais líquida (`pref`) — a mesma que
 * o app lista.
 *
 * Puro: não lê DOM, rede, localStorage nem relógio.
 * Dupla vida (UMD): `window.LastroNewsMatch` no browser; `require()` no Node.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.LastroNewsMatch = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Ticker da B3 no texto cru (mesma regra do coletor, agora global). */
  var TICKER_RE = /\b([A-Z]{4}(?:3|4|5|6|11|34|35|39))\b/g;
  var TICKER_ONE = /^[A-Z]{4}(?:3|4|5|6|11|34|35|39)$/;

  /** minúsculas, sem acento, só letras/números — tudo separado por espaço. */
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* cache pequeno de normalização (o feed reprocessa os mesmos títulos) */
  var _cache = Object.create(null), _cacheN = 0;
  function normCached(s) {
    var k = String(s == null ? '' : s);
    var v = _cache[k];
    if (v !== undefined) return v;
    v = norm(k);
    if (_cacheN > 800) { _cache = Object.create(null); _cacheN = 0; }
    _cache[k] = v; _cacheN++;
    return v;
  }

  /** true se `term` (já normalizado) aparece como palavra(s) inteira(s) no texto normalizado. */
  function hasTerm(padded, term) {
    return term ? padded.indexOf(' ' + term + ' ') >= 0 : false;
  }

  /* ════════════════════════════════════════════════════════════
     MAPA CURADO — raiz de 4 letras → nomes comerciais
       t : termos SEGUROS (nome próprio, sem ambiguidade)
       c : [termo, contexto] — termo ambíguo, só vale se o contexto casar
       n : vetos — se o título contém isto, a entrada inteira é descartada
       pref : classe usada pelo COLETOR ao marcar (a mais líquida / a que o app lista)
     ════════════════════════════════════════════════════════════ */
  var MAP = {
    /* ── Petróleo, gás e energia ── */
    PETR: { pref: 'PETR4', t: ['petrobras', 'petroleo brasileiro'] },
    PRIO: { pref: 'PRIO3', t: ['petrorio', 'prio'] },
    RECV: { pref: 'RECV3', t: ['petroreconcavo', 'petro reconcavo'] },
    BRAV: { pref: 'BRAV3', t: ['brava energia', '3r petroleum'] },
    UGPA: { pref: 'UGPA3', t: ['ultrapar'] },
    VBBR: { pref: 'VBBR3', t: ['vibra energia'] },
    CSAN: { pref: 'CSAN3', t: ['cosan'] },
    RAIZ: { pref: 'RAIZ4', t: ['raizen'] },
    ENEV: { pref: 'ENEV3', t: ['eneva'] },
    ELET: { pref: 'ELET3', t: ['eletrobras'] },
    TAEE: { pref: 'TAEE11', t: ['taesa'] },
    EGIE: { pref: 'EGIE3', t: ['engie brasil', 'engie'] },
    EQTL: { pref: 'EQTL3', t: ['equatorial'], n: ['guine equatorial'] },
    CPLE: { pref: 'CPLE6', t: ['copel'] },
    CMIG: { pref: 'CMIG4', t: ['cemig'] },
    CPFE: { pref: 'CPFE3', t: ['cpfl'] },
    ENGI: { pref: 'ENGI11', t: ['energisa'] },
    NEOE: { pref: 'NEOE3', t: ['neoenergia'] },
    AURE: { pref: 'AURE3', t: ['auren'] },
    LIGT: { pref: 'LIGT3', c: [['light', 'energia|eletric|distribuidora|recupera|concession|apagao|aneel']] },
    SBSP: { pref: 'SBSP3', t: ['sabesp'] },
    CSMG: { pref: 'CSMG3', t: ['copasa'] },
    SAPR: { pref: 'SAPR11', t: ['sanepar'] },
    ORVR: { pref: 'ORVR3', t: ['orizon'] },
    AMBP: { pref: 'AMBP3', t: ['ambipar'] },

    /* ── Mineração, siderurgia, papel, química ── */
    VALE: {
      pref: 'VALE3',
      t: ['vale s a', 'vale sa', 'vale do rio doce', 'mineradora vale'],
      c: [['vale', 'miner|minerio|ferro|carajas|brumadinho|samarco|niquel|cobre|pelota|vitoria a minas|dividendo|jcp|balanco|trimestre|acoes|bolsa|ibovespa|capex']],
    },
    CMIN: { pref: 'CMIN3', t: ['csn mineracao'] },
    CSNA: { pref: 'CSNA3', t: ['csn', 'companhia siderurgica nacional'], n: ['csn mineracao'] },
    GGBR: { pref: 'GGBR4', t: ['gerdau'], n: ['metalurgica gerdau'] },
    GOAU: { pref: 'GOAU4', t: ['metalurgica gerdau'] },
    USIM: { pref: 'USIM5', t: ['usiminas'] },
    SUZB: { pref: 'SUZB3', t: ['suzano'] },
    KLBN: { pref: 'KLBN11', t: ['klabin'] },
    RANI: { pref: 'RANI3', t: ['irani'] },
    DXCO: { pref: 'DXCO3', t: ['dexco', 'duratex'] },
    BRKM: { pref: 'BRKM5', t: ['braskem'] },
    UNIP: { pref: 'UNIP6', t: ['unipar'] },

    /* ── Bancos e financeiro ── */
    ITUB: { pref: 'ITUB4', t: ['itau unibanco', 'itau'] },
    ITSA: { pref: 'ITSA4', t: ['itausa'] },
    BBDC: { pref: 'BBDC4', t: ['bradesco'] },
    BBAS: { pref: 'BBAS3', t: ['banco do brasil'], n: ['banco central do brasil'] },
    SANB: { pref: 'SANB11', t: ['santander'] },
    BPAC: { pref: 'BPAC11', c: [['btg pactual', 'banco|lucro|resultado|balanco|trimestre|acoes|dividendo|jcp|receita|carteira de credito|banco de investimento']] },
    BRSR: { pref: 'BRSR6', t: ['banrisul'] },
    ABCB: { pref: 'ABCB4', t: ['banco abc brasil'] },
    BMGB: { pref: 'BMGB4', t: ['banco bmg'] },
    PINE: { pref: 'PINE4', t: ['banco pine'] },
    BBSE: { pref: 'BBSE3', t: ['bb seguridade'] },
    CXSE: { pref: 'CXSE3', t: ['caixa seguridade'] },
    PSSA: { pref: 'PSSA3', t: ['porto seguro'] },
    IRBR: { pref: 'IRBR3', t: ['irb brasil', 'irb re'] },
    CASH: { pref: 'CASH3', t: ['meliuz'] },

    /* ── Consumo, varejo e alimentos ── */
    ABEV: { pref: 'ABEV3', t: ['ambev'] },
    JBSS: { pref: 'JBSS3', t: ['jbs'] },
    MRFG: { pref: 'MRFG3', t: ['marfrig'] },
    BEEF: { pref: 'BEEF3', t: ['minerva foods'] },
    BRFS: { pref: 'BRFS3', t: ['brf'] },
    MDIA: { pref: 'MDIA3', t: ['m dias branco', 'dias branco'] },
    CAML: { pref: 'CAML3', t: ['camil'] },
    SMTO: { pref: 'SMTO3', t: ['sao martinho'] },
    SLCE: { pref: 'SLCE3', t: ['slc agricola'] },
    AGRO: { pref: 'AGRO3', t: ['brasilagro'] },
    TTEN: { pref: 'TTEN3', t: ['3tentos'] },
    NTCO: { pref: 'NTCO3', t: ['natura'] },
    MGLU: { pref: 'MGLU3', t: ['magazine luiza', 'magalu'] },
    LREN: { pref: 'LREN3', t: ['lojas renner', 'renner'] },
    AMER: { pref: 'AMER3', t: ['americanas'] },
    ASAI: { pref: 'ASAI3', t: ['assai'] },
    PCAR: { pref: 'PCAR3', t: ['pao de acucar', 'grupo pao de acucar', 'gpa'] },
    CRFB: { pref: 'CRFB3', t: ['carrefour'] },
    GMAT: { pref: 'GMAT3', t: ['grupo mateus'] },
    PETZ: { pref: 'PETZ3', t: ['petz'] },
    VIVA: { pref: 'VIVA3', t: ['vivara'] },
    SBFG: { pref: 'SBFG3', t: ['grupo sbf', 'centauro'] },
    SMFT: { pref: 'SMFT3', t: ['smart fit', 'smartfit'] },
    AZZA: { pref: 'AZZA3', t: ['azzas', 'arezzo'] },
    GRND: { pref: 'GRND3', t: ['grendene'] },
    ALPA: { pref: 'ALPA4', t: ['alpargatas', 'havaianas'] },
    VULC: { pref: 'VULC3', t: ['vulcabras'] },
    CVCB: { pref: 'CVCB3', t: ['cvc'] },
    RADL: { pref: 'RADL3', t: ['raia drogasil', 'raiadrogasil', 'rd saude', 'droga raia', 'drogasil'] },
    HYPE: { pref: 'HYPE3', t: ['hypera'] },
    PGMN: { pref: 'PGMN3', t: ['pague menos'] },

    /* ── Saúde e educação ── */
    RDOR: { pref: 'RDOR3', t: ['rede d or', 'rede dor'] },
    HAPV: { pref: 'HAPV3', t: ['hapvida'] },
    DASA: { pref: 'DASA3', t: ['dasa', 'diagnosticos da america'] },
    FLRY: { pref: 'FLRY3', t: ['fleury'] },
    ODPV: { pref: 'ODPV3', t: ['odontoprev'] },
    QUAL: { pref: 'QUAL3', t: ['qualicorp'] },
    ONCO: { pref: 'ONCO3', t: ['oncoclinicas'] },
    MATD: { pref: 'MATD3', t: ['mater dei'] },
    COGN: { pref: 'COGN3', t: ['cogna', 'kroton'] },
    YDUQ: { pref: 'YDUQ3', t: ['yduqs', 'estacio'] },
    ANIM: { pref: 'ANIM3', t: ['anima educacao'] },
    SEER: { pref: 'SEER3', t: ['ser educacional'] },

    /* ── Indústria, transporte e logística ── */
    WEGE: { pref: 'WEGE3', t: ['weg'] },
    EMBR: { pref: 'EMBR3', t: ['embraer'] },
    TUPY: { pref: 'TUPY3', t: ['tupy'] },
    POMO: { pref: 'POMO4', t: ['marcopolo'] },
    RAPT: { pref: 'RAPT4', t: ['randon'] },
    MYPK: { pref: 'MYPK3', t: ['iochpe', 'maxion'] },
    LEVE: { pref: 'LEVE3', t: ['mahle metal leve', 'metal leve'] },
    FRAS: { pref: 'FRAS3', t: ['fras le'] },
    KEPL: { pref: 'KEPL3', t: ['kepler weber'] },
    RAIL: { pref: 'RAIL3', t: ['rumo logistica'], c: [['rumo', 'ferrovi|malha norte|malha central|graos|trilho|terminal|logistic|vagao|locomotiva']] },
    STBP: { pref: 'STBP3', t: ['santos brasil'] },
    ECOR: { pref: 'ECOR3', t: ['ecorodovias'] },
    CCRO: { pref: 'CCRO3', t: ['ccr'] },
    LOGG: { pref: 'LOGG3', t: ['log commercial'] },
    RENT: { pref: 'RENT3', t: ['localiza'] },
    MOVI: { pref: 'MOVI3', t: ['movida'] },
    SIMH: { pref: 'SIMH3', t: ['simpar'] },
    AZUL: { pref: 'AZUL4', t: ['azul linhas aereas'], c: [['azul', 'aere|aviac|voo|companhia aerea|malha aerea|aeroport|anac|chapter 11|recupera']] },
    GOLL: { pref: 'GOLL4', t: ['gol linhas aereas'], c: [['gol', 'aere|aviac|voo|companhia aerea|malha aerea|aeroport|anac|chapter 11|abra group']] },

    /* ── Construção e shoppings ── */
    CYRE: { pref: 'CYRE3', t: ['cyrela'] },
    MRVE: { pref: 'MRVE3', t: ['mrv'] },
    EZTC: { pref: 'EZTC3', t: ['eztec'] },
    TEND: {
      pref: 'TEND3',
      t: ['construtora tenda'],
      c: [['tenda', 'constru|incorporad|imobili|habitac|minha casa|vgv|lancament|obra|canteiro|lucro|receita|balanco|acoes|dividend|resultado|guidance']],
      n: ['tenda atacado', 'tenda atacarejo'],
    },
    DIRR: { pref: 'DIRR3', c: [['direcional', 'constru|incorporad|imobili|habitac|minha casa|vgv|lancament|riva|obra|lucro|receita|balanco|acoes|dividend|resultado']] },
    CURY: { pref: 'CURY3', t: ['cury'] },
    PLPL: { pref: 'PLPL3', t: ['plano e plano'] },
    TRIS: { pref: 'TRIS3', t: ['trisul'] },
    JHSF: { pref: 'JHSF3', t: ['jhsf'] },
    MULT: { pref: 'MULT3', t: ['multiplan'] },
    IGTI: { pref: 'IGTI11', t: ['iguatemi'] },
    ALOS: { pref: 'ALOS3', t: ['allos', 'aliansce sonae'] },

    /* ── Tecnologia e telecom ── */
    TOTS: { pref: 'TOTS3', t: ['totvs'] },
    LWSA: { pref: 'LWSA3', t: ['locaweb'] },
    VIVT: { pref: 'VIVT3', t: ['telefonica brasil', 'telefonica'] },
    TIMS: { pref: 'TIMS3', c: [['tim', 'telecom|telefonia|5g|4g|movel|anatel|banda larga|operadora|fibra']] },
  };

  /* Palavras que NUNCA valem como nome de empresa sozinhas (substantivo comum,
     adjetivo ou termo genérico de mercado). Usado pelo gate do `learn()`. */
  var COMMON = (
    'vale tenda rumo azul gol vivo light soma vamos positivo unidas marisa banco bancos brasil brasileira ' +
    'brasileiro energia energias saude alimentos alimento agro log logistica bolsa mercado acao acoes lucro ' +
    'renda capital credito seguro seguros seguridade participacoes participacao investimento investimentos ' +
    'industria industrias comercio distribuicao holding holdings grupo companhia cia nacional geral central ' +
    'uniao gerais norte sul leste oeste rio sao santa santo minas terra campo campos fonte ponte porto praia ' +
    'serra monte morro ouro prata cobre ferro papel celulose cimento obra obras casa lar plano planos tempo ' +
    'mundo futuro alfa beta gama delta atacado varejo global local direto direta digital tecnologia telecom ' +
    'saneamento transporte transportes rodovias ferrovias aereas aerea educacao escola servicos servico ' +
    'sistema sistemas solucoes uniao real reais boa bom nova novo velha grande maior menor primeira primeiro'
  ).split(' ');
  var COMMON_SET = Object.create(null);
  COMMON.forEach(function (w) { if (w) COMMON_SET[w] = 1; });

  /* Tokens genéricos removidos das PONTAS de uma razão social ao aprender nomes. */
  var EDGE_GENERIC = {
    s: 1, a: 1, sa: 1, ltda: 1, me: 1, epp: 1, cia: 1, companhia: 1, cimpanhia: 1,
    holding: 1, holdings: 1, participacoes: 1, participacao: 1, part: 1, empreendimentos: 1,
    industria: 1, industrias: 1, comercio: 1, on: 1, pn: 1, unt: 1, units: 1, ord: 1, nm: 1,
    brasil: 1, brasileira: 1, brasileiro: 1, do: 1, da: 1, de: 1, e: 1, group: 1, grupo: 1, inc: 1, corp: 1,
  };

  /* compila os contextos uma única vez */
  Object.keys(MAP).forEach(function (root) {
    var e = MAP[root];
    if (e.c) e._c = e.c.map(function (p) { return [norm(p[0]), new RegExp(p[1]) ]; });
    if (e.t) e._t = e.t.map(norm);
    if (e.n) e._n = e.n.map(norm);
  });

  function rootOf(tk) {
    var t = String(tk || '').toUpperCase();
    return TICKER_ONE.test(t) ? t.slice(0, 4) : '';
  }

  /** Tickers literais citados no texto (ordem de aparição, sem repetir). */
  function tickersInText(text) {
    var out = [], seen = Object.create(null), m;
    var s = String(text == null ? '' : text).toUpperCase();
    TICKER_RE.lastIndex = 0;
    while ((m = TICKER_RE.exec(s))) {
      if (!seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
    }
    return out;
  }

  /** A entrada `e` casa com o título normalizado (já com espaços nas pontas)? */
  function entryHits(e, padded) {
    var i;
    if (e._n) for (i = 0; i < e._n.length; i++) if (hasTerm(padded, e._n[i])) return false;   // veto
    if (e._t) for (i = 0; i < e._t.length; i++) if (hasTerm(padded, e._t[i])) return true;
    if (e._c) for (i = 0; i < e._c.length; i++) {
      if (hasTerm(padded, e._c[i][0]) && e._c[i][1].test(padded)) return true;               // ambíguo + contexto
    }
    return false;
  }

  /** Raízes de 4 letras citadas pelo NOME no título (sem considerar ticker literal). */
  function rootsInTitle(title) {
    var padded = ' ' + normCached(title) + ' ', out = [];
    for (var root in MAP) if (entryHits(MAP[root], padded)) out.push(root);
    return out;
  }

  /**
   * Tickers a marcar numa manchete: literais + os inferidos por nome.
   * Se a empresa já apareceu por ticker literal, a inferência por nome não
   * duplica (não vira PETR3 + PETR4 no mesmo título).
   */
  function matchTickers(title) {
    var lits = tickersInText(title);
    var litRoots = Object.create(null);
    lits.forEach(function (t) { var r = rootOf(t); if (r) litRoots[r] = 1; });
    var out = lits.slice();
    rootsInTitle(title).forEach(function (r) {
      if (litRoots[r]) return;
      var p = MAP[r] && MAP[r].pref;
      if (p && out.indexOf(p) < 0) out.push(p);
    });
    return out;
  }

  /** Primeiro ticker da manchete (compatível com o campo `ticker` do banco). */
  function primaryTicker(title) {
    var all = matchTickers(title);
    return all.length ? all[0] : null;
  }

  /**
   * A manchete fala DESTE ativo? Usado pela página do ativo (casa retroativamente
   * notícias já gravadas sem marcação). Aceita outra classe da MESMA empresa
   * (PETR3 ↔ PETR4), que é o que o leitor espera.
   */
  function matchesTicker(title, tk) {
    var t = String(tk || '').toUpperCase();
    if (!t) return false;
    var lits = tickersInText(title);
    if (lits.indexOf(t) >= 0) return true;
    var r = rootOf(t);
    if (!r) return false;
    for (var i = 0; i < lits.length; i++) if (rootOf(lits[i]) === r) return true;
    var e = MAP[r];
    return e ? entryHits(e, ' ' + normCached(title) + ' ') : false;
  }

  /**
   * Aprende nomes de uma lista curada [{tk, nm}] — SÓ o que passa no portão:
   * frase contígua, sem tokens genéricos nas pontas, e nome de uma palavra só
   * é aceito quando não é substantivo comum e tem ≥5 letras.
   * Nunca sobrescreve o mapa curado. Devolve quantos entraram.
   * NÃO use com razão social crua de fonte externa (ex.: brapi) — é nome legal
   * em caixa alta, que a manchete não usa, e amplia o risco de falso positivo.
   */
  function learn(items) {
    var added = 0;
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it) return;
      var tk = String(it.tk || '').toUpperCase();
      if (!TICKER_ONE.test(tk)) return;
      var root = tk.slice(0, 4);
      if (MAP[root]) return;                       // curado tem precedência
      var term = cleanName(it.nm);
      if (!term) return;
      MAP[root] = { pref: tk, t: [term], _t: [term], learned: true };
      added++;
    });
    return added;
  }

  /** Nome comercial → termo seguro, ou '' se não passar no portão. */
  function cleanName(nm) {
    var toks = norm(nm).split(' ').filter(Boolean);
    while (toks.length && EDGE_GENERIC[toks[0]]) toks.shift();
    while (toks.length && EDGE_GENERIC[toks[toks.length - 1]]) toks.pop();
    if (!toks.length) return '';
    if (toks.length === 1) {
      var w = toks[0];
      if (w.length < 5 || COMMON_SET[w] || /^[0-9]+$/.test(w)) return '';
      return w;
    }
    return toks.join(' ');
  }

  return {
    norm: norm,
    rootOf: rootOf,
    tickersInText: tickersInText,
    rootsInTitle: rootsInTitle,
    matchTickers: matchTickers,
    primaryTicker: primaryTicker,
    matchesTicker: matchesTicker,
    cleanName: cleanName,
    learn: learn,
    MAP: MAP,
  };
});

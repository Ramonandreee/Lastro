/**
 * LastroMovs — Livro de Movimentações (redutor PURO de estado da carteira).
 * ────────────────────────────────────────────────────────────────────
 * MOVS é a fonte de verdade dos eventos ({id,date,type,tk?,...}). Este módulo
 * reconstrói, de forma DETERMINÍSTICA e em CENTAVOS INTEIROS (via LastroMoney),
 * o estado da carteira numa data D: posições (cotas, custo, preço médio, lotes),
 * saldo em CAIXA (sempre BRL) e resultado realizado por ano (para IR futuro).
 *
 * Puro: não lê localStorage, DOM nem relógio. Câmbio USD entra por opts.fx
 * (função (cur, dateStr) -> taxa p/ BRL); default trata tudo como BRL (fx=1).
 *
 * FASE 1 — tipos suportados: compra, venda, provento, aporte, resgate.
 * Eventos societários (desdobramento/grupamento/bonificação/transferência) e IR
 * realizado ficam como no-op comentado no switch, prontos para as próximas fases.
 *
 * Dupla vida (UMD): `window.LastroMovs` no browser; `require()` no Node (testes).
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'));
  else global.LastroMovs = factory(global.LastroMoney);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';

  var FAR = '9999-12-31';

  // ordena MOVS por date (asc); empate = ordem de inserção (índice no array) → determinístico
  function sortMovs(MOVS) {
    var arr = Array.isArray(MOVS) ? MOVS : [];
    return arr
      .map(function (m, i) { return { m: m, i: i }; })
      .sort(function (a, b) {
        var da = String((a.m && a.m.date) || ''), db = String((b.m && b.m.date) || '');
        if (da < db) return -1;
        if (da > db) return 1;
        return a.i - b.i;
      })
      .map(function (x) { return x.m; });
  }

  // redutor PURO: aplica evento a evento (date<=D) e devolve o estado derivado.
  // opts.fx(cur,dateStr) -> taxa p/ BRL (default: BRL=1, USD=opts.usd||1).
  function deriveState(MOVS, D, opts) {
    opts = opts || {};
    var fx = opts.fx || function (cur) { return cur === 'usd' ? (Number(opts.usd) || 1) : 1; };
    var dstr = D ? String(D).slice(0, 10) : FAR;
    var list = sortMovs(MOVS).filter(function (m) { return m && String(m.date || '').slice(0, 10) <= dstr; });

    var posByTk = {};
    var caixaCents = 0;
    var realizadoCents = {};

    function pos(tk, cur, firstDate) {
      if (!posByTk[tk]) posByTk[tk] = { cotas: 0, custoCentsNat: 0, pm: 0, cur: cur || 'brl', lots: [], _firstDate: firstDate };
      return posByTk[tk];
    }

    for (var n = 0; n < list.length; n++) {
      var mv = list[n];
      var type = mv.type;

      if (type === 'compra') {
        var tk = mv.tk;
        var q = Number(mv.cotas) || 0, preco = Number(mv.preco) || 0, taxa = Number(mv.taxa) || 0;
        if (q <= 0) continue;
        var p = pos(tk, mv.cur, mv.date);
        if (mv.cur) p.cur = mv.cur;
        var costNatCents = M.positionCents(q, preco) + M.toCents(taxa);   // custo nativo (moeda do ativo), em centavos
        // pm do LOTE: sem taxa, pm === preco EXATO (nada de ida-e-volta por centavos) → invariante "zero mudança"
        var lotPm = taxa ? (q * preco + taxa) / q : preco;
        p.cotas += q;
        p.custoCentsNat += costNatCents;
        p.pm = p.cotas > 0 ? p.custoCentsNat / (p.cotas * 100) : 0;   // pm ponderado (unidades da moeda)
        p.lots.push({ id: mv.id, tk: tk, cotas: q, pm: lotPm, date: mv.date });
        // Fase 1: compra é NEUTRA em caixa — funding externo (não há depósito de caixa registrado).
        // Caixa só se move por provento/venda/aporte/resgate. Rever na fase de gestão de caixa.
      } else if (type === 'venda') {
        var tkv = mv.tk;
        var qv = Number(mv.cotas) || 0, precv = Number(mv.preco) || 0, taxv = Number(mv.taxa) || 0;
        if (qv <= 0) continue;
        var pv = posByTk[tkv];
        var curv = pv ? pv.cur : (mv.cur || 'brl');
        var pmv = pv ? pv.pm : 0;
        var proceedsNatCents = M.positionCents(qv, precv) - M.toCents(taxv);   // q·preco − taxa (líquido)
        var custoBaixaCents = M.positionCents(qv, pmv);                        // q·pm (baixa pelo PM ponderado)
        var resultadoNatCents = proceedsNatCents - custoBaixaCents;           // = q·preco − q·pm − taxa
        if (pv) {
          var before = pv.cotas;
          pv.cotas -= qv;
          if (pv.cotas <= 1e-9) {
            // zerou a posição: custo e lotes zerados (spec: cotas→0 zera custoNat)
            pv.cotas = 0; pv.custoCentsNat = 0; pv.lots = [];
          } else {
            // baixa por PM: reduz cada lote proporcionalmente (PM de cada lote e o ponderado NÃO mudam)
            var factor = before > 0 ? pv.cotas / before : 0;
            pv.custoCentsNat = M.roundCents(pv.custoCentsNat * factor);
            pv.lots.forEach(function (l) { l.cotas = l.cotas * factor; });
            pv.pm = pv.cotas > 0 ? pv.custoCentsNat / (pv.cotas * 100) : pv.pm;
          }
        }
        caixaCents += M.convertCents(proceedsNatCents, fx(curv, mv.date));   // entra o líquido da venda
        var yr = String(mv.date || '').slice(0, 4) || '----';
        var r = realizadoCents[yr] || (realizadoCents[yr] = { ganhoCents: 0 });
        r.ganhoCents += M.convertCents(resultadoNatCents, fx(curv, mv.date));
      } else if (type === 'provento') {
        // posição e PM intactos (dividendo NÃO reduz custo na convenção brasileira); só entra caixa.
        // JCP: o campo `valor` já deve vir LÍQUIDO (15% IRRF) informado pelo usuário.
        var vp = Number(mv.valor) || 0;
        caixaCents += M.convertCents(M.toCents(vp), fx(mv.cur || 'brl', mv.date));
      } else if (type === 'aporte') {
        var va = Number(mv.valor) || 0;
        caixaCents += M.convertCents(M.toCents(va), fx(mv.cur || 'brl', mv.date));
      } else if (type === 'resgate') {
        var vr = Number(mv.valor) || 0;
        caixaCents -= M.convertCents(M.toCents(vr), fx(mv.cur || 'brl', mv.date));
      }
      // ── Fases futuras (no-op nesta Fase 1, deixados prontos no redutor) ──
      // else if (type === 'desdobramento') { p.cotas *= fator; p.pm /= fator;  /* custoNat inalterado */ }
      // else if (type === 'grupamento')   { p.cotas /= fator; p.pm *= fator;  /* custoNat inalterado */ }
      // else if (type === 'bonificacao')  { p.cotas += q; p.custoCentsNat += q·custoUnit; /* reduz PM */ }
      // else if (type === 'transferencia'){ p.cotas ±= q; ajusta custoNat pelo custo; /* caixa intacto */ }
      // else: tipo desconhecido → no-op seguro (nunca inventa número).
    }

    // recomputa PM final e mantém apenas lotes com cotas>0 (compat wealthSeries/portfolioByTicker)
    Object.keys(posByTk).forEach(function (tk) {
      var p = posByTk[tk];
      p.pm = p.cotas > 0 ? p.custoCentsNat / (p.cotas * 100) : 0;
      p.lots = p.lots.filter(function (l) { return l.cotas > 1e-9; });
    });

    return { posByTk: posByTk, caixaCents: caixaCents, realizadoCents: realizadoCents };
  }

  // projeção CARTEIRA [{id,tk,cotas,pm,date}] a partir das posições ABERTAS em `atéD` (default: sem corte).
  function rebuildLots(MOVS, ateD, opts) {
    var st = deriveState(MOVS, ateD || FAR, opts);
    var out = [];
    Object.keys(st.posByTk).forEach(function (tk) {
      var p = st.posByTk[tk];
      if (p.cotas > 1e-9) {
        p.lots.forEach(function (l) {
          if (l.cotas > 1e-9) out.push({ id: l.id, tk: l.tk || tk, cotas: l.cotas, pm: l.pm, date: l.date });
        });
      }
    });
    return out;
  }

  return { sortMovs: sortMovs, deriveState: deriveState, rebuildLots: rebuildLots };
});

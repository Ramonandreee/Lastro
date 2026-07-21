/**
 * LastroMoney — aritmética monetária em CENTAVOS INTEIROS (precisão de extrato).
 * ────────────────────────────────────────────────────────────────────
 * Por que: somar dinheiro em ponto flutuante acumula erro (0,1 + 0,2 ≠ 0,3).
 * Representamos cada valor como INT de centavos; a soma de inteiros é EXATA
 * (JS é exato até 2^53 ≈ R$ 90 tri). Regra de arredondamento: cada POSIÇÃO é
 * arredondada uma vez, ao centavo (como no extrato da corretora); os agregados
 * somam centavos inteiros — sem drift.
 *
 * Dupla vida (UMD): `window.LastroMoney` no browser; `require()` no Node (testes).
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.LastroMoney = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // arredondamento "meio para cima" simétrico (independe do sinal)
  function roundCents(x) {
    if (!isFinite(x)) return 0;
    return x < 0 ? -Math.round(-x) : Math.round(x);
  }

  // reais (número) → centavos inteiros
  function toCents(reais) {
    const n = Number(reais);
    return isFinite(n) ? roundCents(n * 100) : 0;
  }

  // centavos inteiros → reais (número)
  function fromCents(cents) {
    return roundCents(cents) / 100;
  }

  // valor de uma posição em centavos: full precision de preço/quantidade, arredonda 1x.
  // Ex.: 100 × 40,153 → 4015,30 → 401530 centavos (não perde a 3ª casa do preço antes de somar).
  function positionCents(cotas, precoReais) {
    return roundCents(Number(cotas) * Number(precoReais) * 100);
  }

  // soma exata de centavos (garante inteiros na entrada)
  function sumCents(list) {
    let s = 0;
    for (const c of list) s += roundCents(c);
    return s;
  }

  // conversão de moeda em centavos (ex.: USD¢ → BRL¢), arredondando 1x
  function convertCents(cents, rate) {
    return roundCents(roundCents(cents) * Number(rate));
  }

  // variação percentual a partir de centavos (retorna número em %, base = |from|)
  function pctCents(deltaCents, baseCents) {
    const b = roundCents(baseCents);
    return b ? (roundCents(deltaCents) / b) * 100 : 0;
  }

  return { roundCents, toCents, fromCents, positionCents, sumCents, convertCents, pctCents };
});

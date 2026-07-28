/**
 * LastroEnt — derivação PURA do plano efetivo a partir do entitlement do servidor.
 * ────────────────────────────────────────────────────────────────────
 * Recebe a linha `user_entitlement` (já normalizada em memória) e o "agora" em ms, e
 * devolve o plano EFETIVO, aplicando status (cancelado/inadimplente) e validade
 * (current_period_end). É a regra que decide se o Premium ainda vale — por isso é pura
 * e testada (nunca depende de relógio/DOM internos).
 *
 * ent = { plan:'free'|'premium'|'pro', tier?:string, status?:string, periodEnd?:number(ms) }
 * retorno = { plan:'free'|'premium'|'pro', tier:string|null }
 *
 * Dupla vida (UMD): `window.LastroEnt` no browser; `require()` no Node (testes).
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.LastroEnt = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FREE = { plan: 'free', tier: null };

  // plano efetivo aplicando status + validade. Sem ent → 'free'.
  function effectivePlan(ent, nowMs) {
    if (!ent) return { plan: 'free', tier: null };
    var plan = ent.plan || 'free';
    if (plan === 'free') return { plan: 'free', tier: null };
    if (ent.status && ent.status !== 'active') return { plan: 'free', tier: null };   // cancelado/inadimplente
    if (ent.periodEnd && nowMs > ent.periodEnd) return { plan: 'free', tier: null };  // período expirou
    return { plan: plan, tier: ent.tier || null };
  }

  // true se há acesso Premium/Pro efetivo agora.
  function isPremiumEffective(ent, nowMs) {
    return effectivePlan(ent, nowMs).plan !== 'free';
  }

  // 'free' | 'premium' | 'pro' — Pro se o plano é 'pro' OU o tier é 'pro'.
  function tierEffective(ent, nowMs) {
    var e = effectivePlan(ent, nowMs);
    if (e.plan === 'free') return 'free';
    return (e.plan === 'pro' || e.tier === 'pro') ? 'pro' : 'premium';
  }

  return { FREE: FREE, effectivePlan: effectivePlan, isPremiumEffective: isPremiumEffective, tierEffective: tierEffective };
});

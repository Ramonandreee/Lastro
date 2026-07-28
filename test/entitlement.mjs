/**
 * Testes da derivação de plano efetivo (vendor/entitlement.js) — a regra que decide
 * se o Premium ainda vale (status + validade). Módulo UMD via require().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Ent = require('../vendor/entitlement.js');

const NOW = 1_700_000_000_000;        // "agora" fixo (determinístico)
const FUT = NOW + 86_400_000;         // +1 dia
const PAST = NOW - 86_400_000;        // −1 dia

test('sem entitlement → free', () => {
  assert.deepEqual(Ent.effectivePlan(null, NOW), { plan: 'free', tier: null });
  assert.equal(Ent.isPremiumEffective(null, NOW), false);
  assert.equal(Ent.tierEffective(null, NOW), 'free');
});

test('premium ativo dentro do período → premium', () => {
  const e = { plan: 'premium', status: 'active', periodEnd: FUT };
  assert.deepEqual(Ent.effectivePlan(e, NOW), { plan: 'premium', tier: null });
  assert.equal(Ent.isPremiumEffective(e, NOW), true);
  assert.equal(Ent.tierEffective(e, NOW), 'premium');
});

test('pro ativo → tier pro', () => {
  const e = { plan: 'pro', tier: 'pro', status: 'active', periodEnd: FUT };
  assert.equal(Ent.tierEffective(e, NOW), 'pro');
  assert.equal(Ent.isPremiumEffective(e, NOW), true);
});

test('tier pro no campo tier (plan premium) → pro', () => {
  const e = { plan: 'premium', tier: 'pro', status: 'active', periodEnd: FUT };
  assert.equal(Ent.tierEffective(e, NOW), 'pro');
});

test('cancelado → free (mesmo com período futuro)', () => {
  const e = { plan: 'premium', status: 'canceled', periodEnd: FUT };
  assert.equal(Ent.effectivePlan(e, NOW).plan, 'free');
  assert.equal(Ent.isPremiumEffective(e, NOW), false);
});

test('período expirado → free', () => {
  const e = { plan: 'premium', status: 'active', periodEnd: PAST };
  assert.equal(Ent.effectivePlan(e, NOW).plan, 'free');
});

test('premium sem periodEnd (sem validade) permanece premium', () => {
  const e = { plan: 'premium', status: 'active', periodEnd: 0 };
  assert.equal(Ent.effectivePlan(e, NOW).plan, 'premium');
});

test('status ausente assume ativo', () => {
  const e = { plan: 'premium', periodEnd: FUT };
  assert.equal(Ent.effectivePlan(e, NOW).plan, 'premium');
});

test('plan free explícito → free', () => {
  assert.equal(Ent.effectivePlan({ plan: 'free' }, NOW).plan, 'free');
});

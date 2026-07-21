/**
 * Testes das datas/dedupe do histórico (lib/history.js) — base da reconstrução
 * dia-a-dia do patrimônio. Data errada = ponto do gráfico no dia errado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDay, dedupeAsc } from '../lib/history.js';

test('isoDay: epoch(ms) → YYYY-MM-DD em UTC, com zero-pad', () => {
  assert.equal(isoDay(Date.UTC(2026, 0, 5)), '2026-01-05');    // jan, dia 5 → zero-pad
  assert.equal(isoDay(Date.UTC(2026, 6, 20)), '2026-07-20');
  assert.equal(isoDay(Date.UTC(2026, 11, 31)), '2026-12-31');
});

test('dedupeAsc: remove dia repetido (fica o último) e ordena ascendente', () => {
  const inp = [
    { d: '2026-01-02', c: 2 },
    { d: '2026-01-01', c: 1 },
    { d: '2026-01-02', c: 3 },   // repetido → prevalece o último (3)
  ];
  assert.deepEqual(dedupeAsc(inp), [
    { d: '2026-01-01', c: 1 },
    { d: '2026-01-02', c: 3 },
  ]);
});

test('dedupeAsc: lista vazia → vazia', () => {
  assert.deepEqual(dedupeAsc([]), []);
});

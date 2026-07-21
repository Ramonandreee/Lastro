/**
 * Testes do mapeamento de dados de mercado (lib/crypto.js, lib/usdetail.js).
 * pct: conversão fração→% (a auditoria financeira apontou risco de dupla conversão).
 * mapOne: mapeia campos da CoinGecko p/ o shape do app, com fallback de variação 24h.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOne } from '../lib/crypto.js';
import { pct } from '../lib/usdetail.js';

test('pct: fração → % com 2 casas (sem dupla conversão)', () => {
  assert.equal(pct(0.0044), 0.44);   // DY 0,44%
  assert.equal(pct(0.35), 35);       // ROE 35%
  assert.equal(pct('0.05'), 5);      // aceita string numérica
  assert.equal(pct(null), null);
  assert.equal(pct('x'), null);
});

test('mapOne: mapeia CoinGecko → shape do app', () => {
  const c = {
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin',
    current_price: 319807, market_cap: 6.3e12, market_cap_rank: 1,
    total_volume: 5e10, high_24h: 320000, low_24h: 315000,
    price_change_percentage_1h_in_currency: 0.1,
    price_change_percentage_24h_in_currency: 0.59,
    price_change_percentage_7d_in_currency: 3.2,
    circulating_supply: 19.7e6, max_supply: 21e6,
    ath: 400000, ath_change_percentage: -20, atl: 300,
  };
  const m = mapOne(c);
  assert.equal(m.tk, 'BTC');           // symbol → uppercase
  assert.equal(m.px, 319807);
  assert.equal(m.mktN, 6.3e12);
  assert.equal(m.rank, 1);
  assert.equal(m.v24, 0.59);
  assert.equal(m.maxSupply, 21e6);
});

test('mapOne: variação 24h cai no campo simples quando falta o *_in_currency', () => {
  const m = mapOne({ symbol: 'eth', name: 'Ethereum', current_price: 100, price_change_percentage_24h: 1.23 });
  assert.equal(m.v24, 1.23);           // fallback
  assert.equal(m.tk, 'ETH');
});

test('mapOne: campos ausentes viram null (não NaN/undefined)', () => {
  const m = mapOne({ symbol: 'sol', name: 'Solana' });
  assert.equal(m.px, null);
  assert.equal(m.mktN, null);
  assert.equal(m.v24, null);
});

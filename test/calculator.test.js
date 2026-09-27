'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const shipping = require('../src/lib/shipping');
const pricing = require('../src/lib/pricing');
const shippingWatch = require('../src/content/shipping-watch');

const log = [
  { category: '1234', weightGrams: 99, charge: 95 },
  { category: '1234', weightGrams: 120, charge: 91 },
  { category: '1234', weightGrams: 300, charge: 97 },
  { category: '1234', weightGrams: 800, charge: 140 },
];
const categoryInfo = { 1234: { baseShipping: 90 }, 5555: { baseShipping: 60 } };

test('estimate prefers the live panel figure, then logged charges, then category base', () => {
  const l = { categoryId: '1234', declaredGrams: 150 };
  assert.deepEqual(shipping.estimateForListing(l, { live: { charge: 88, categoryId: '1234' }, log, categoryInfo }), { amount: 88, source: 'live', low: 88, high: 88, samples: 1 });
  const obs = shipping.estimateForListing(l, { log, categoryInfo });
  assert.equal(obs.source, 'observed');
  assert.equal(obs.amount, 95);
  assert.equal(obs.low, 91);
  assert.equal(obs.high, 97);
  assert.equal(obs.samples, 3);
  const cat = shipping.estimateForListing({ categoryId: '1234', declaredGrams: 1400 }, { log, categoryInfo });
  assert.equal(cat.source, 'category');
  assert.equal(cat.low, 91);
  assert.equal(cat.high, 140);
  assert.deepEqual(shipping.estimateForListing({ categoryId: '5555', declaredGrams: 200 }, { log, categoryInfo }), { amount: 60, source: 'base', low: 60, high: 60, samples: 0 });
  assert.equal(shipping.estimateForListing({ categoryId: '9' }, { config: { rateModel: { firstSlab: 70, additionalSlab: 20 } } }).amount, 70);
  assert.equal(shipping.estimateForListing({ categoryId: '9' }, {}).source, 'unknown');
});

test('a live figure from another category is not reused', () => {
  const e = shipping.estimateForListing({ categoryId: '5555' }, { live: { charge: 88, categoryId: '1234' }, categoryInfo });
  assert.equal(e.source, 'base');
});

test('quote reproduces the panel breakdown and its price + shipping > MRP warning', () => {
  // The screenshot case: price 999, MRP 999, shipping 95, GST 18%.
  const q = pricing.quote({ price: 999, mrp: 999, productGstPct: 18, shippingCharge: 95, costPrice: 400, packagingCost: 10 });
  assert.equal(q.settlement, 993.44);
  assert.equal(q.customerPays, 1094);
  assert.equal(q.taxesShown, 5.57); // panel shows 5.56 after its own -0.01 fee-GST rounding
  assert.ok(q.warnings.some((w) => /above MRP/.test(w)));
  assert.equal(pricing.quote({ price: 999, mrp: 1999, productGstPct: 18, shippingCharge: 95 }).warnings.length, 0);
  assert.ok(pricing.quote({ price: 999, mrp: 900, shippingCharge: 95 }).warnings.some((w) => /higher than MRP/.test(w)));
});

test('quote returns the price needed for a target profit', () => {
  const q = pricing.quote({ price: 500, productGstPct: 18, shippingCharge: 90, costPrice: 400, targetProfit: 100 });
  assert.ok(q.priceForTarget > 500);
  assert.ok(pricing.breakdown({ price: q.priceForTarget, productGstPct: 18, shippingCharge: 90, costPrice: 400 }).profit >= 100);
});

test('price ladder steps around the current price', () => {
  const rows = pricing.priceLadder({ price: 100, productGstPct: 0, shippingCharge: 50 }, null, { steps: 2, step: 40 });
  assert.deepEqual(rows.map((r) => r.price), [20, 60, 100, 140, 180]);
  assert.equal(rows.find((r) => r.current).price, 100);
  assert.equal(rows[0].customerPays, 70);
});

test('GST enrolment sellers are not charged TCS', () => {
  const b = pricing.breakdown({ price: 999, productGstPct: 18, shippingCharge: 95 }, { gstEnrolmentOnly: true });
  assert.equal(b.tcs, 0);
  assert.equal(b.tds, 0.93);
});

test('schema messages yield the category base shipping', () => {
  const win = {};
  const msg = shippingWatch.readObserverMessage(
    { source: win, data: { source: 'msa-page-observer', kind: 'productSchema', request: { sub_sub_category_id: 1234 }, response: { shipping_price: 90, wdrp_discount_max_percentage: 30, query: {} } } },
    win,
  );
  assert.deepEqual(msg, { kind: 'productSchema', categoryId: '1234', baseShipping: 90, wdrpMaxPct: 30 });
  const fromQuery = shippingWatch.readObserverMessage(
    { source: win, data: { source: 'msa-page-observer', kind: 'productSchema', request: null, response: { shipping_price: '75', query: { sscat_id: '42' } } } },
    win,
  );
  assert.equal(fromQuery.categoryId, '42');
  assert.equal(fromQuery.baseShipping, 75);
});

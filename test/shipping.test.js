'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const shipping = require('../src/lib/shipping');

test('volumetric and chargeable weight', () => {
  assert.equal(shipping.volumetricGrams({ length: 20, breadth: 15, height: 10 }), 600);
  assert.equal(shipping.chargeableGrams(450, { length: 20, breadth: 15, height: 10 }), 600);
  assert.equal(shipping.chargeableGrams(700, null), 700);
});

test('slab index and position', () => {
  assert.equal(shipping.slabIndex(1), 1);
  assert.equal(shipping.slabIndex(500), 1);
  assert.equal(shipping.slabIndex(501), 2);
  const pos = shipping.slabPosition(520);
  assert.equal(pos.index, 2);
  assert.equal(pos.headroomGrams, 480);
  assert.equal(pos.overPreviousGrams, 20);
});

const log = [
  { category: 'Earbuds', weightGrams: 180, charge: 60 },
  { category: 'Earbuds', weightGrams: 450, charge: 64 },
  { category: 'Earbuds', weightGrams: 300, charge: 62 },
  { category: 'Earbuds', weightGrams: 800, charge: 95 },
  { category: 'Earbuds', weightGrams: 0, charge: 10 }, // ignored: no weight
];

test('rateTable summarises observed charges per category and slab', () => {
  const t = shipping.rateTable(log);
  assert.deepEqual(t.Earbuds[1], { count: 3, min: 60, median: 62, max: 64 });
  assert.deepEqual(t.Earbuds[2], { count: 1, min: 95, median: 95, max: 95 });
});

test('estimateCharge falls back to the rate model, then unknown', () => {
  const t = shipping.rateTable(log);
  assert.deepEqual(shipping.estimateCharge(400, 'Earbuds', t), { amount: 62, source: 'observed', slab: 1 });
  assert.equal(shipping.estimateCharge(400, 'Other', t, { rateModel: { firstSlab: 50, additionalSlab: 20 } }).amount, 50);
  assert.equal(shipping.estimateCharge(1200, 'Other', t, { rateModel: { firstSlab: 50, additionalSlab: 20 } }).amount, 90);
  assert.equal(shipping.estimateCharge(400, 'Other', t).source, 'unknown');
});

test('rankPackaging picks the cheapest honest total', () => {
  const t = shipping.rateTable(log);
  const ranked = shipping.rankPackaging(
    { weightGrams: 420, category: 'Earbuds' },
    [
      { name: 'Box', weightGrams: 120, cost: 8 },
      { name: 'Poly mailer', weightGrams: 30, cost: 4 },
    ],
    t,
  );
  assert.equal(ranked[0].name, 'Poly mailer');
  assert.equal(ranked[0].slab, 1);
  assert.equal(ranked[0].totalCost, 66);
  assert.equal(ranked[1].slab, 2);
  assert.equal(ranked[1].totalCost, 103);
});

test('advise flags weights just over a slab boundary with the saving', () => {
  const t = shipping.rateTable(log);
  const adv = shipping.advise(520, 'Earbuds', t);
  assert.equal(adv.tips[0].kind, 'near-lower-slab');
  assert.match(adv.tips[0].message, /20 g above slab 1/);
  assert.match(adv.tips[0].message, /₹33/);
  assert.equal(shipping.advise(250, 'Earbuds', t).tips.length, 0);
  assert.equal(shipping.advise(490, 'Earbuds', t).tips[0].kind, 'near-upper-slab');
});

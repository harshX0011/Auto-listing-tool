'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../src/lib/pricing');

test('matches the panel transfer-price breakdown observed in the reference capture', () => {
  // Captured response: price 999, shipping 95, GST 18% ->
  // tcs 4.64, tds 0.93, transfer_price 993.44, total_price 1094.
  const b = pricing.breakdown({ price: 999, productGstPct: 18, shippingCharge: 95 });
  assert.equal(b.tcs, 4.64);
  assert.equal(b.tds, 0.93);
  assert.equal(b.settlement, 993.44);
  assert.equal(b.customerPays, 1094);
  assert.equal(b.commission, 0);
});

test('profit subtracts GST liability, costs and platform fees but not recoverable TCS/TDS', () => {
  const b = pricing.breakdown({ price: 590, productGstPct: 18, costPrice: 300, packagingCost: 10, shippingCharge: 60 });
  // taxable 500, GST 90 -> 590 - 90 - 300 - 10 = 190
  assert.equal(b.outputGst, 90);
  assert.equal(b.profit, 190);
  assert.equal(b.marginPct, 32.2);
});

test('input tax credit and returns are applied', () => {
  const b = pricing.breakdown({ price: 590, productGstPct: 18, costPrice: 300, inputTaxCredit: 54, returnRatePct: 10, returnCostPerOrder: 80 });
  assert.equal(b.netGstPayable, 36);
  assert.equal(b.profit, 254);
  assert.equal(b.expectedProfit, 0.9 * 254 - 0.1 * 80);
});

test('commission, fixed fee and seller-borne shipping reduce settlement', () => {
  const b = pricing.breakdown(
    { price: 1000, productGstPct: 0, shippingCharge: 50 },
    { commissionPct: 10, fixedFeePerOrder: 5, gstOnFeesPct: 18, tcsPct: 0, tdsPct: 0, shippingBorneBySeller: true },
  );
  assert.equal(b.commission, 100);
  assert.equal(b.feeGst, 18.9);
  assert.equal(b.settlement, 1000 - 100 - 5 - 18.9 - 50);
  assert.equal(b.customerPays, 1000);
});

test('priceForTarget returns the smallest whole-rupee price reaching the target', () => {
  const input = { productGstPct: 5, costPrice: 250, packagingCost: 12, shippingCharge: 70 };
  const p = pricing.priceForTarget(100, input);
  assert.ok(pricing.breakdown(Object.assign({}, input, { price: p })).profit >= 100);
  assert.ok(pricing.breakdown(Object.assign({}, input, { price: p - 1 })).profit < 100);
});

test('parseAmount handles rupee strings', () => {
  assert.equal(pricing.parseAmount('₹1,094.50'), 1094.5);
  assert.equal(pricing.parseAmount('abc', 7), 7);
});

test('fromPanelTransferPrice normalises the observed response shape', () => {
  const r = pricing.fromPanelTransferPrice({
    price: 999, commission_fees: 0, commission_percentage: 0, gst_price: -0.01,
    tcs: 4.64, transfer_price: 993.44, tds: 0.93, shipping_charges: 95, total_price: 1094,
  });
  assert.deepEqual(r, { price: 999, commission: 0, commissionPct: 0, feeGst: -0.01, tcs: 4.64, tds: 0.93, settlement: 993.44, shippingCharge: 95, customerPays: 1094 });
  assert.equal(pricing.fromPanelTransferPrice(null), null);
});

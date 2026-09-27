/*
 * Per-order payout and profit model.
 *
 * Every fee is configurable because marketplace fee rules and tax rates change.
 * Defaults are starting points only; sellers should verify them against their
 * own settlement statements (see docs/ARCHITECTURE.md, "Pricing model").
 */
(function (root) {
  'use strict';

  const DEFAULT_FEES = {
    commissionPct: 0, // platform commission on selling price
    fixedFeePerOrder: 0, // any flat fee per order
    gstOnFeesPct: 18, // GST charged on commission and fixed fee
    tcsPct: 0.5, // GST TCS on taxable value, recoverable against GST liability
    tdsPct: 0.1, // income-tax TDS (194-O), recoverable against income tax
    shippingBorneBySeller: false, // true if forward shipping is deducted from payout
  };

  const round2 = (n) => Math.round(n * 100) / 100;
  const num = (v, fallback = 0) => {
    const n = typeof v === 'string' ? parseFloat(v.replace(/[₹,\s]/g, '')) : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  /**
   * @param {object} input
   * @param {number} input.price            selling price, GST inclusive
   * @param {number} [input.productGstPct]  GST rate of the product
   * @param {number} [input.costPrice]      landed cost of goods per unit
   * @param {number} [input.packagingCost]
   * @param {number} [input.shippingCharge] forward shipping shown by the panel
   * @param {number} [input.inputTaxCredit] GST paid on purchases, per unit
   * @param {number} [input.returnRatePct]  share of orders that come back (RTO + customer returns)
   * @param {number} [input.returnCostPerOrder] loss on a returned order excluding packaging
   * @param {object} [fees]
   */
  function breakdown(input, fees) {
    const f = Object.assign({}, DEFAULT_FEES, fees || {});
    const price = num(input.price);
    const gstPct = num(input.productGstPct);
    const costPrice = num(input.costPrice);
    const packagingCost = num(input.packagingCost);
    const shippingCharge = num(input.shippingCharge);
    const inputTaxCredit = num(input.inputTaxCredit);
    const returnRate = Math.min(Math.max(num(input.returnRatePct) / 100, 0), 1);
    const returnCost = num(input.returnCostPerOrder);

    const taxableValue = price / (1 + gstPct / 100);
    const outputGst = price - taxableValue;
    const commission = (price * num(f.commissionPct)) / 100;
    const fixedFee = num(f.fixedFeePerOrder);
    const feeGst = ((commission + fixedFee) * num(f.gstOnFeesPct)) / 100;
    const shippingDeduction = f.shippingBorneBySeller ? shippingCharge : 0;
    const tcs = (taxableValue * num(f.tcsPct)) / 100;
    const tds = (taxableValue * num(f.tdsPct)) / 100;

    const platformDeductions = commission + fixedFee + feeGst + shippingDeduction;
    const settlement = price - platformDeductions - tcs - tds;
    const netGstPayable = Math.max(outputGst - inputTaxCredit, 0);
    // TCS and TDS are credits the seller recovers, so they hit cash flow, not profit.
    const profit = price - platformDeductions - netGstPayable - costPrice - packagingCost;
    const expectedProfit = (1 - returnRate) * profit - returnRate * (returnCost + packagingCost);

    return {
      price: round2(price),
      taxableValue: round2(taxableValue),
      outputGst: round2(outputGst),
      commission: round2(commission),
      fixedFee: round2(fixedFee),
      feeGst: round2(feeGst),
      shippingDeduction: round2(shippingDeduction),
      tcs: round2(tcs),
      tds: round2(tds),
      settlement: round2(settlement),
      netGstPayable: round2(netGstPayable),
      profit: round2(profit),
      marginPct: price > 0 ? round2((profit / price) * 100) : 0,
      expectedProfit: round2(expectedProfit),
      customerPays: round2(price + (f.shippingBorneBySeller ? 0 : shippingCharge)),
    };
  }

  /**
   * Smallest whole-rupee price whose profit (or expectedProfit) reaches target.
   * Profit is linear in price, so two evaluations give the exact line.
   */
  function priceForTarget(target, input, fees, metric = 'profit') {
    const at = (p) => breakdown(Object.assign({}, input, { price: p }), fees)[metric];
    // Evaluate without rounding noise by using a wide span.
    const p0 = 0;
    const p1 = 100000;
    const slope = (at(p1) - at(p0)) / (p1 - p0);
    if (slope <= 0) return null;
    const exact = (num(target) - at(p0)) / slope;
    let price = Math.max(Math.ceil(exact), 1);
    // Guard against rounding in breakdown().
    while (at(price) < num(target)) price += 1;
    return price;
  }

  const api = { DEFAULT_FEES, breakdown, priceForTarget, parseAmount: num };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MSA = root.MSA || {}).pricing = api;
})(globalThis);

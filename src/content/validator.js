/*
 * Pre-submit checklist run against what is currently typed in the form.
 * Advisory only: it reports, the seller decides.
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const dom = isNode ? require('./dom') : root.MSA.dom;
  const scanner = isNode ? require('./scanner') : root.MSA.scanner;
  const pricing = isNode ? require('../lib/pricing') : root.MSA.pricing;

  // Observed in the panel's form schema; the panel enforces its own limits too.
  const WDRP_MAX_PCT = 30;

  function isRequired(control) {
    const el = control.el;
    return (
      el.required ||
      el.getAttribute('aria-required') === 'true' ||
      /\*/.test(control.label || '')
    );
  }

  /**
   * @param {ParentNode} scope
   * @param {{profile?:object, transferPrice?:object, fees?:object, selectorOverrides?:object}} [ctx]
   * @returns {{errors:string[], warnings:string[], info:string[]}}
   */
  function check(scope, ctx) {
    const c = ctx || {};
    const errors = [];
    const warnings = [];
    const info = [];
    const result = scanner.scan(scope, { selectorOverrides: c.selectorOverrides });
    const values = scanner.readValues(result);
    const num = (v) => (v === '' || v == null ? null : pricing.parseAmount(v, NaN));

    for (const control of result.controls) {
      if (control.kind === 'file' || !isRequired(control)) continue;
      if (!dom.currentValue(control.el)) errors.push(`Required: ${control.label || 'unnamed field'}`);
    }

    const price = num(values.fields.meeshoPrice);
    const mrp = num(values.fields.mrp);
    if (price !== null && mrp !== null && price > mrp) errors.push('Meesho price is higher than MRP');
    const wdrp = num(values.fields.wdrpDiscount);
    if (wdrp !== null && price) {
      const pct = (wdrp / price) * 100;
      if (pct > WDRP_MAX_PCT) warnings.push(`Wrong/defective return discount is ${pct.toFixed(0)}% of price (panel limit is about ${WDRP_MAX_PCT}%)`);
    }
    if (values.fields.weight !== undefined && !num(values.fields.weight)) warnings.push('Net weight is empty or zero');

    const tp = c.transferPrice;
    const costs = c.profile && c.profile.costs;
    if (tp && costs && costs.costPrice != null && price) {
      const b = pricing.breakdown(
        {
          price,
          productGstPct: num(values.fields.gst) || 0,
          shippingCharge: tp.shippingCharge,
          costPrice: costs.costPrice,
          packagingCost: costs.packagingCost,
        },
        c.fees,
      );
      if (b.profit < 0) errors.push(`Loss of ₹${Math.abs(b.profit)} per order at this price`);
      else info.push(`Profit ≈ ₹${b.profit} per order (${b.marginPct}% of price)`);
      if (costs.targetProfit != null && b.profit < Number(costs.targetProfit)) {
        const need = pricing.priceForTarget(costs.targetProfit, { productGstPct: num(values.fields.gst) || 0, shippingCharge: tp.shippingCharge, costPrice: costs.costPrice, packagingCost: costs.packagingCost }, c.fees);
        if (need) warnings.push(`Below target profit; price ₹${need} would reach ₹${costs.targetProfit}`);
      }
    }
    if (tp) info.push(`Shipping ₹${tp.shippingCharge}, customer pays ₹${tp.customerPays}, settlement ₹${tp.settlement}`);
    return { errors, warnings, info };
  }

  const api = { check, isRequired, WDRP_MAX_PCT };
  if (isNode) module.exports = api;
  else (root.MSA = root.MSA || {}).validator = api;
})(globalThis);

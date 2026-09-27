/*
 * Collects the shipping charge the panel shows for the product being listed.
 *
 * Primary source: the panel's own transfer-price responses, forwarded by
 * page-observer.js. Fallback: reading the amount from visible text using
 * configurable patterns, for when the response format changes.
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const pricing = isNode ? require('../lib/pricing') : root.MSA.pricing;

  const OBSERVER_SOURCE = 'msa-page-observer';

  /** Validate and normalise a message posted by page-observer.js. */
  function readObserverMessage(event, expectedWindow) {
    if (!event || event.source !== expectedWindow) return null;
    const d = event.data;
    if (!d || d.source !== OBSERVER_SOURCE || d.kind !== 'transferPrice') return null;
    const tp = pricing.fromPanelTransferPrice(d.response);
    if (!tp || !Number.isFinite(tp.shippingCharge)) return null;
    const req = d.request && typeof d.request === 'object' ? d.request : {};
    return {
      transferPrice: tp,
      request: {
        price: pricing.parseAmount(req.price, tp.price),
        gstPct: req.gst_percentage == null ? null : pricing.parseAmount(req.gst_percentage, null),
        subSubCategoryId: req.sscat_id == null ? null : String(req.sscat_id),
      },
    };
  }

  /** Fallback: find "Shipping charges ... ₹95" style text in the page. */
  function findChargeInText(scope, patterns) {
    const text = String((scope && (scope.innerText || scope.textContent)) || '').replace(/\s+/g, ' ');
    for (const src of patterns || []) {
      let re;
      try {
        re = new RegExp(src, 'i');
      } catch (e) {
        continue;
      }
      const m = re.exec(text);
      if (m && m[1]) {
        const amount = pricing.parseAmount(m[1], NaN);
        if (Number.isFinite(amount)) return { amount, text: m[0].slice(0, 120) };
      }
    }
    return null;
  }

  const api = { OBSERVER_SOURCE, readObserverMessage, findChargeInText };
  if (isNode) module.exports = api;
  else (root.MSA = root.MSA || {}).shippingWatch = api;
})(globalThis);

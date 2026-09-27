/*
 * Shipping-cost insight.
 *
 * The panel computes the actual shipping charge server side. We do not try to
 * influence that calculation with misleading inputs. What we do:
 *   1. Physics: chargeable weight = max(actual, volumetric), mapped to slabs.
 *   2. Packaging choice: pick the packaging whose honest chargeable weight and
 *      cost gives the lowest total.
 *   3. Evidence: every charge the panel shows is logged locally with its
 *      category, declared weight and price, so sellers can see the real rate
 *      card per category and how close each product sits to a slab boundary.
 */
(function (root) {
  'use strict';

  const DEFAULT_CONFIG = {
    volumetricDivisor: 5000, // cm^3 per kg, the common courier convention
    slabSizeGrams: 500,
    // Optional flat rate model used when there is no logged evidence yet.
    rateModel: { firstSlab: 0, additionalSlab: 0 },
  };

  const cfg = (c) => Object.assign({}, DEFAULT_CONFIG, c || {}, {
    rateModel: Object.assign({}, DEFAULT_CONFIG.rateModel, (c && c.rateModel) || {}),
  });

  function volumetricGrams(dims, divisor = DEFAULT_CONFIG.volumetricDivisor) {
    if (!dims) return 0;
    const l = Number(dims.length) || 0;
    const b = Number(dims.breadth) || 0;
    const h = Number(dims.height) || 0;
    return Math.round(((l * b * h) / divisor) * 1000);
  }

  function chargeableGrams(actualGrams, dims, config) {
    const c = cfg(config);
    return Math.max(Math.round(Number(actualGrams) || 0), volumetricGrams(dims, c.volumetricDivisor));
  }

  /** 1-based slab index: 1..500g -> 1, 501..1000g -> 2 (for 500g slabs). */
  function slabIndex(grams, config) {
    const size = cfg(config).slabSizeGrams;
    return Math.max(1, Math.ceil((Number(grams) || 0) / size));
  }

  function slabBounds(index, config) {
    const size = cfg(config).slabSizeGrams;
    return { from: (index - 1) * size + 1, to: index * size };
  }

  /** How far a weight is from the slab edges. */
  function slabPosition(grams, config) {
    const index = slabIndex(grams, config);
    const bounds = slabBounds(index, config);
    return {
      index,
      bounds,
      headroomGrams: bounds.to - grams, // grams you can add without changing slab
      overPreviousGrams: index > 1 ? grams - (bounds.from - 1) : null, // grams to shed to drop a slab
    };
  }

  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /**
   * Build a per-category slab rate table from logged observations.
   * @param {Array<{category?:string, weightGrams:number, price?:number, charge:number}>} log
   * @returns {{[category:string]: {[slab:number]: {count:number,min:number,median:number,max:number}}}}
   */
  function rateTable(log, config) {
    const table = {};
    for (const o of log || []) {
      if (!Number.isFinite(Number(o.charge)) || !Number(o.weightGrams)) continue;
      const cat = o.category || 'Uncategorised';
      const slab = slabIndex(o.weightGrams, config);
      ((table[cat] = table[cat] || {})[slab] = table[cat][slab] || []).push(Number(o.charge));
    }
    const out = {};
    for (const cat of Object.keys(table)) {
      out[cat] = {};
      for (const slab of Object.keys(table[cat])) {
        const v = table[cat][slab];
        out[cat][slab] = { count: v.length, min: Math.min(...v), median: median(v), max: Math.max(...v) };
      }
    }
    return out;
  }

  /** Estimate a charge from evidence first, then the configured rate model. */
  function estimateCharge(grams, category, table, config) {
    const c = cfg(config);
    const slab = slabIndex(grams, c);
    const row = table && table[category || 'Uncategorised'];
    if (row && row[slab]) return { amount: row[slab].median, source: 'observed', slab };
    const { firstSlab, additionalSlab } = c.rateModel;
    if (firstSlab > 0) return { amount: firstSlab + (slab - 1) * additionalSlab, source: 'rate-model', slab };
    return { amount: null, source: 'unknown', slab };
  }

  /**
   * Rank packaging options by total cost (packaging + estimated shipping).
   * @param {{weightGrams:number, category?:string}} product  product weight without packaging
   * @param {Array<{name:string, weightGrams:number, cost:number, dims?:object}>} options
   */
  function rankPackaging(product, options, table, config) {
    const results = (options || []).map((opt) => {
      const actual = (Number(product.weightGrams) || 0) + (Number(opt.weightGrams) || 0);
      const grams = chargeableGrams(actual, opt.dims, config);
      const est = estimateCharge(grams, product.category, table, config);
      const pos = slabPosition(grams, config);
      const total = est.amount == null ? null : est.amount + (Number(opt.cost) || 0);
      return {
        name: opt.name,
        actualGrams: actual,
        volumetricGrams: volumetricGrams(opt.dims, cfg(config).volumetricDivisor),
        chargeableGrams: grams,
        slab: pos.index,
        headroomGrams: pos.headroomGrams,
        estimatedShipping: est.amount,
        estimateSource: est.source,
        packagingCost: Number(opt.cost) || 0,
        totalCost: total,
      };
    });
    return results.sort((a, b) => {
      if (a.totalCost == null && b.totalCost == null) return a.chargeableGrams - b.chargeableGrams;
      if (a.totalCost == null) return 1;
      if (b.totalCost == null) return -1;
      return a.totalCost - b.totalCost || a.chargeableGrams - b.chargeableGrams;
    });
  }

  /**
   * Plain-language advice for one product. Only suggests honest changes
   * (lighter or smaller packaging); never suggests declaring a different weight.
   */
  function advise(grams, category, table, config) {
    const pos = slabPosition(grams, config);
    const tips = [];
    const current = estimateCharge(grams, category, table, config);
    if (pos.index > 1 && pos.overPreviousGrams <= 0.1 * cfg(config).slabSizeGrams) {
      const lower = estimateCharge(pos.bounds.from - 1, category, table, config);
      const saving = current.amount != null && lower.amount != null ? current.amount - lower.amount : null;
      tips.push({
        kind: 'near-lower-slab',
        message:
          `Packed weight is only ${pos.overPreviousGrams} g above slab ${pos.index - 1}. ` +
          'Lighter or smaller packaging could move it down' +
          (saving > 0 ? `, saving about ₹${saving} per order.` : '.'),
      });
    }
    if (pos.headroomGrams <= 0.05 * cfg(config).slabSizeGrams) {
      tips.push({
        kind: 'near-upper-slab',
        message: `Only ${pos.headroomGrams} g headroom before slab ${pos.index + 1}. Avoid heavier packaging for this product.`,
      });
    }
    return { position: pos, estimate: current, tips };
  }

  const api = {
    DEFAULT_CONFIG,
    volumetricGrams,
    chargeableGrams,
    slabIndex,
    slabBounds,
    slabPosition,
    rateTable,
    estimateCharge,
    rankPackaging,
    advise,
    median,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MSA = root.MSA || {}).shipping = api;
})(globalThis);

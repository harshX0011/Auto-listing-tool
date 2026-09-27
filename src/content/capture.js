/*
 * Reads what the seller has typed into the add-catalog form and turns it into
 * profile data: canonical fields by key, everything else (category
 * attributes such as Color, Play Time, Warranty) by its visible label.
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const dom = isNode ? require('./dom') : root.MSA.dom;
  const scanner = isNode ? require('./scanner') : root.MSA.scanner;

  // Unique per listing; copying them into another product causes duplicates.
  const DEFAULT_EXCLUDE = ['styleCode', 'skuId'];

  // Placeholder-like values the panel shows in empty or not-applicable fields.
  const EMPTY_VALUES = new Set(['', 'select', 'not required', '-']);

  function cleanLabel(label) {
    return String(label || '')
      .replace(/\*/g, ' ')
      .replace(/\(optional\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @param {ParentNode} scope
   * @param {{exclude?:string[], selectorOverrides?:object}} [opts]
   * @returns {{fields:object, attributes:object, count:number}}
   */
  function captureForm(scope, opts) {
    const o = opts || {};
    const exclude = new Set(o.exclude || DEFAULT_EXCLUDE);
    const result = scanner.scan(scope, { selectorOverrides: o.selectorOverrides });
    const out = { fields: {}, attributes: {}, count: 0 };

    const read = (c) => {
      if (c.kind === 'file' || c.el.disabled) return null;
      const v = String(dom.currentValue(c.el) || '').trim();
      return EMPTY_VALUES.has(v.toLowerCase()) ? null : v;
    };

    for (const [key, c] of Object.entries(result.byKey)) {
      if (exclude.has(key)) continue;
      const v = read(c);
      if (v != null) {
        out.fields[key] = v;
        out.count += 1;
      }
    }
    for (const c of result.unmatched.concat(Object.values(result.byAttribute))) {
      if (c.key) continue; // a repeated canonical field, already captured above
      const name = cleanLabel(c.label);
      if (!name || name.length > 60 || name in out.attributes) continue;
      const v = read(c);
      if (v != null) {
        out.attributes[name] = v;
        out.count += 1;
      }
    }
    return out;
  }

  /** Short default profile name from the product name. */
  function suggestName(captured) {
    const n = captured.fields.productName || 'Captured profile';
    return n.length > 40 ? n.slice(0, 40).trim() + '…' : n;
  }

  const api = { captureForm, suggestName, cleanLabel, DEFAULT_EXCLUDE };
  if (isNode) module.exports = api;
  else (root.MSA = root.MSA || {}).capture = api;
})(globalThis);

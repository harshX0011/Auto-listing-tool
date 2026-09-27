/*
 * Finds the listing form's controls and maps each one to a canonical field
 * or to a category attribute from the active profile.
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const dom = isNode ? require('./dom') : root.MSA.dom;
  const fields = isNode ? require('../lib/fields') : root.MSA.fields;

  /**
   * @param {ParentNode} scope
   * @param {{selectorOverrides?:object, attributeNames?:string[]}} [opts]
   * @returns {{controls:Array, byKey:Object, byAttribute:Object, unmatched:Array}}
   */
  function scan(scope, opts) {
    const o = opts || {};
    const overrides = o.selectorOverrides || {};
    const attributeNames = o.attributeNames || [];
    const controls = [];
    const claimed = new Set();

    // 1. Manual overrides always win.
    for (const [key, selector] of Object.entries(overrides)) {
      if (!selector) continue;
      let el = null;
      try {
        el = scope.querySelector(selector);
      } catch (e) {
        continue; // invalid selector typed by the user
      }
      if (el && !claimed.has(el)) {
        claimed.add(el);
        controls.push({ el, label: dom.getLabelText(el), kind: dom.controlKind(el), key, attribute: null, score: 1000 });
      }
    }

    // 2. Label-based detection for everything else.
    for (const el of scope.querySelectorAll(dom.INPUT_SELECTOR)) {
      if (claimed.has(el) || !dom.isVisible(el) || el.disabled) continue;
      // Skip search inputs that belong to an open dropdown.
      if (el.closest('[role=listbox], [role=menu]')) continue;
      // A combobox wrapper around a real input: the inner input is the control.
      if (!/^(input|textarea|select)$/i.test(el.tagName) && el.querySelector('input:not([type=hidden]):not([aria-hidden=true]), textarea')) continue;
      const label = dom.getLabelText(el);
      const kind = dom.controlKind(el);
      const field =
        fields.matchIdentifier(el.getAttribute('name')) ||
        fields.matchIdentifier(dom.stableId(el)) ||
        fields.matchLabel(label);
      const attr = fields.matchAttribute(label, attributeNames);
      let entry;
      // A profile attribute that matches the label exactly beats a weak generic match.
      if (attr && (!field || attr.score >= field.score)) {
        entry = { el, label, kind, key: null, attribute: attr.name, score: attr.score };
      } else if (field) {
        entry = { el, label, kind, key: field.key, attribute: null, score: field.score };
      } else {
        entry = { el, label, kind, key: null, attribute: null, score: 0 };
      }
      controls.push(entry);
    }

    // Keep the best-scoring control per key/attribute; the rest become unmatched.
    const byKey = {};
    const byAttribute = {};
    const allByKey = {}; // every control per key, in page order (one per size row)
    for (const c of controls) {
      if (c.key) (allByKey[c.key] = allByKey[c.key] || []).push(c);
      if (c.key) {
        if (!byKey[c.key] || c.score > byKey[c.key].score) byKey[c.key] = c;
      } else if (c.attribute) {
        if (!byAttribute[c.attribute] || c.score > byAttribute[c.attribute].score) byAttribute[c.attribute] = c;
      }
    }
    const winners = new Set([...Object.values(byKey), ...Object.values(byAttribute)]);
    const unmatched = controls.filter((c) => !winners.has(c));
    return { controls, byKey, byAttribute, allByKey, unmatched };
  }

  /** Read current form values keyed by canonical key and attribute name. */
  function readValues(result) {
    const out = { fields: {}, attributes: {} };
    for (const [k, c] of Object.entries(result.byKey)) out.fields[k] = dom.currentValue(c.el);
    for (const [k, c] of Object.entries(result.byAttribute)) out.attributes[k] = dom.currentValue(c.el);
    return out;
  }

  const api = { scan, readValues };
  if (isNode) module.exports = api;
  else (root.MSA = root.MSA || {}).scanner = api;
})(globalThis);

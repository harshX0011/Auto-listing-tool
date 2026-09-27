/*
 * Reusable product profiles.
 *
 * A profile holds values for canonical fields plus free-form category
 * attributes. Profiles can extend a base profile (for example a "Brand
 * defaults" profile with manufacturer, packer, country and GST), so a new
 * product only needs the values that differ.
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const fields = isNode ? require('./fields') : root.MSA.fields;

  const EXPORT_VERSION = 1;
  const COMMON_GST_RATES = [0, 3, 5, 18, 40];

  function newId() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function createProfile(partial) {
    const p = partial || {};
    return {
      id: p.id || newId(),
      name: p.name || 'Untitled profile',
      extends: p.extends || null,
      category: p.category || '',
      fields: Object.assign({}, p.fields),
      attributes: Object.assign({}, p.attributes),
      costs: Object.assign({ costPrice: null, packagingCost: null, targetProfit: null }, p.costs),
      packaging: Object.assign({ weightGrams: null, dims: null }, p.packaging),
      updatedAt: p.updatedAt || new Date().toISOString(),
    };
  }

  /** Merge a profile with its ancestors. Child values win; cycles are cut. */
  function resolveProfile(id, allProfiles) {
    const byId = new Map((allProfiles || []).map((p) => [p.id, p]));
    const chain = [];
    const seen = new Set();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.extends ? byId.get(cur.extends) : null;
    }
    if (!chain.length) return null;
    const merged = createProfile({ id, name: chain[chain.length - 1].name });
    merged.extends = chain[chain.length - 1].extends;
    for (const p of chain) {
      if (p.category) merged.category = p.category;
      Object.assign(merged.fields, stripEmpty(p.fields));
      Object.assign(merged.attributes, stripEmpty(p.attributes));
      Object.assign(merged.costs, stripEmpty(p.costs));
      Object.assign(merged.packaging, stripEmpty(p.packaging));
    }
    return merged;
  }

  function stripEmpty(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (v !== null && v !== undefined && v !== '') out[k] = v;
    }
    return out;
  }

  /** Replace {{name}} tokens using fields, attributes and extra context. */
  function renderTemplate(value, profile, extra) {
    if (typeof value !== 'string') return value;
    const ctx = Object.assign({}, profile.attributes, profile.fields, extra);
    const lower = {};
    for (const k of Object.keys(ctx)) lower[k.toLowerCase()] = ctx[k];
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, name) => {
      const v = lower[name.toLowerCase()];
      return v === undefined || v === null ? '' : String(v);
    }).replace(/\s{2,}/g, ' ').trim();
  }

  /** Values ready to type into the form, with templates rendered. */
  function renderValues(profile, extra) {
    const out = { fields: {}, attributes: {} };
    for (const [k, v] of Object.entries(profile.fields)) out.fields[k] = renderTemplate(v, profile, extra);
    for (const [k, v] of Object.entries(profile.attributes)) out.attributes[k] = renderTemplate(v, profile, extra);
    return out;
  }

  /** Returns {errors:[], warnings:[]} for a resolved profile. */
  function validateProfile(p) {
    const errors = [];
    const warnings = [];
    const f = p.fields || {};
    const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

    for (const key of ['meeshoPrice', 'mrp', 'weight', 'inventory', 'wrongDefectiveReturnsPrice']) {
      const v = n(f[key]);
      if (v !== null && (!Number.isFinite(v) || v < 0)) errors.push(`${key} must be a non-negative number`);
    }
    const price = n(f.meeshoPrice);
    const mrp = n(f.mrp);
    if (price !== null && mrp !== null && price > mrp) errors.push('Selling price is higher than MRP');
    const wd = n(f.wrongDefectiveReturnsPrice);
    if (wd !== null && price !== null && wd > price) warnings.push('Wrong/defective returns price is above the selling price');
    if (f.hsn && !/^\d{4}(\d{2}){0,2}$/.test(String(f.hsn))) errors.push('HSN code should be 4, 6 or 8 digits');
    const gst = n(f.gst);
    if (gst !== null && !COMMON_GST_RATES.includes(gst)) {
      warnings.push(`GST ${gst}% is not one of the common rates (${COMMON_GST_RATES.join(', ')}). Double-check it.`);
    }
    if (f.productName && String(f.productName).length > 200) warnings.push('Product name is very long');
    for (const key of Object.keys(f)) {
      if (!fields.FIELD_KEYS.includes(key)) warnings.push(`Unknown field "${key}" will be ignored`);
    }
    return { errors, warnings };
  }

  function exportProfiles(profiles) {
    return JSON.stringify({ format: 'seller-listing-assistant/profiles', version: EXPORT_VERSION, profiles }, null, 2);
  }

  /** Parse an export. Imported ids are kept so "extends" links survive. */
  function importProfiles(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const list = Array.isArray(data) ? data : data && data.profiles;
    if (!Array.isArray(list)) throw new Error('No profiles found in file');
    return list.map((p) => createProfile(p));
  }

  const api = {
    EXPORT_VERSION,
    COMMON_GST_RATES,
    newId,
    createProfile,
    resolveProfile,
    renderTemplate,
    renderValues,
    validateProfile,
    exportProfiles,
    importProfiles,
  };
  if (isNode) module.exports = api;
  else (root.MSA = root.MSA || {}).profiles = api;
})(globalThis);

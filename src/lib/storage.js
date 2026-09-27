/*
 * Thin promise wrapper over chrome.storage.local, with an in-memory fallback
 * so the same code runs in Node tests. All data stays on the seller's machine.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    profiles: [],
    activeProfileId: null,
    queue: { items: [], index: 0 },
    shippingLog: [],
    settings: {
      fees: null, // null = pricing.DEFAULT_FEES
      shipping: null, // null = shipping.DEFAULT_CONFIG
      overwriteFilled: false,
      autoLogShipping: true,
      maxLogEntries: 2000,
      // Escape hatches for when the panel's markup changes. Keys are canonical
      // field keys, values are CSS selectors.
      selectorOverrides: {},
      // Regex sources used to read the shipping charge from the page.
      shippingPatterns: [
        '(?:shipping|delivery)\\s*(?:charges?|fee|cost)[^₹\\d]{0,40}(?:₹|rs\\.?)\\s*([\\d,]+(?:\\.\\d+)?)',
      ],
    },
  };

  function memoryArea() {
    const data = {};
    return {
      async get(keys) {
        const out = {};
        for (const k of keys) if (k in data) out[k] = JSON.parse(JSON.stringify(data[k]));
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) data[k] = JSON.parse(JSON.stringify(v));
      },
    };
  }

  function chromeArea() {
    const area = root.chrome && root.chrome.storage && root.chrome.storage.local;
    return area || null;
  }

  let fallback = null;
  function area() {
    return chromeArea() || (fallback = fallback || memoryArea());
  }

  async function get(key) {
    const res = await area().get([key]);
    const def = DEFAULTS[key];
    if (!(key in res)) return def === undefined ? undefined : JSON.parse(JSON.stringify(def));
    if (key === 'settings') return Object.assign({}, DEFAULTS.settings, res[key]);
    return res[key];
  }

  async function set(key, value) {
    await area().set({ [key]: value });
  }

  async function upsertProfile(profile) {
    const list = await get('profiles');
    const i = list.findIndex((p) => p.id === profile.id);
    profile.updatedAt = new Date().toISOString();
    if (i >= 0) list[i] = profile;
    else list.push(profile);
    await set('profiles', list);
    return profile;
  }

  async function deleteProfile(id) {
    const list = await get('profiles');
    // Children of a deleted base keep their own values but lose the link.
    const next = list.filter((p) => p.id !== id).map((p) => (p.extends === id ? Object.assign({}, p, { extends: null }) : p));
    await set('profiles', next);
  }

  async function appendShippingObservation(obs) {
    const [log, settings] = await Promise.all([get('shippingLog'), get('settings')]);
    const last = log[log.length - 1];
    const same =
      last &&
      last.charge === obs.charge &&
      last.weightGrams === obs.weightGrams &&
      last.price === obs.price &&
      last.category === obs.category;
    if (same) return false;
    log.push(Object.assign({ ts: new Date().toISOString() }, obs));
    const max = settings.maxLogEntries || DEFAULTS.settings.maxLogEntries;
    await set('shippingLog', log.slice(-max));
    return true;
  }

  function _resetMemory() {
    fallback = null;
  }

  const api = { DEFAULTS, get, set, upsertProfile, deleteProfile, appendShippingObservation, _resetMemory };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MSA = root.MSA || {}).storage = api;
})(globalThis);

'use strict';

(async function () {
  const { storage, profiles, fields, pricing, shipping } = window.MSA;
  const $ = (sel) => document.querySelector(sel);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'className') el.className = v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

  // ---------- tabs ----------
  document.querySelectorAll('nav button').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== 'tab-' + btn.dataset.tab));
      if (btn.dataset.tab === 'shipping') renderShipping();
      if (btn.dataset.tab === 'queue') renderQueue();
    }),
  );

  // ---------- profiles ----------
  let list = await storage.get('profiles');
  let settings = await storage.get('settings');
  let currentId = null;
  const form = $('#profile-form');

  $('#field-inputs').append(
    ...fields.FIELD_DEFS.map((def) =>
      h('label', null, def.label, def.type === 'textarea' ? h('textarea', { name: 'f_' + def.key, rows: 2 }) : h('input', { name: 'f_' + def.key })),
    ),
  );

  function renderList() {
    const ul = $('#profile-list');
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    ul.replaceChildren(
      ...list
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) =>
          h(
            'li',
            { className: p.id === currentId ? 'active' : '', onclick: () => edit(p.id) },
            p.name,
            h('small', null, p.extends && byId[p.extends] ? 'inherits ' + byId[p.extends].name : p.category || 'no category'),
          ),
        ),
    );
    if (!list.length) ul.append(h('li', null, 'No profiles yet. Start with a base profile for details shared by all your products (manufacturer, packer, GST).'));
  }

  function edit(id) {
    currentId = id;
    const p = list.find((x) => x.id === id);
    form.hidden = !p;
    renderList();
    if (!p) return;
    const el = form.elements;
    el.name.value = p.name;
    el.category.value = p.category || '';
    el.extends.replaceChildren(
      h('option', { value: '' }, 'Nothing'),
      ...list.filter((x) => x.id !== id).map((x) => h('option', { value: x.id, selected: x.id === p.extends }, x.name)),
    );
    for (const def of fields.FIELD_DEFS) el['f_' + def.key].value = p.fields[def.key] == null ? '' : p.fields[def.key];
    el.attributes.value = Object.entries(p.attributes).map(([k, v]) => `${k} = ${v}`).join('\n');
    el.costPrice.value = p.costs.costPrice ?? '';
    el.packagingCost.value = p.costs.packagingCost ?? '';
    el.targetProfit.value = p.costs.targetProfit ?? '';
    el.packWeight.value = p.packaging.weightGrams ?? '';
    const d = p.packaging.dims || {};
    el.packL.value = d.length ?? '';
    el.packB.value = d.breadth ?? '';
    el.packH.value = d.height ?? '';
    renderInsight();
  }

  function readForm() {
    const el = form.elements;
    const p = profiles.createProfile(list.find((x) => x.id === currentId));
    p.name = el.name.value.trim() || 'Untitled profile';
    p.category = el.category.value.trim();
    p.extends = el.extends.value || null;
    p.fields = {};
    for (const def of fields.FIELD_DEFS) {
      const v = el['f_' + def.key].value.trim();
      if (v !== '') p.fields[def.key] = v;
    }
    p.attributes = {};
    for (const line of el.attributes.value.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) {
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k && v) p.attributes[k] = v;
      }
    }
    p.costs = { costPrice: numOrNull(el.costPrice.value), packagingCost: numOrNull(el.packagingCost.value), targetProfit: numOrNull(el.targetProfit.value) };
    const dims = [el.packL.value, el.packB.value, el.packH.value].every((v) => v !== '')
      ? { length: Number(el.packL.value), breadth: Number(el.packB.value), height: Number(el.packH.value) }
      : null;
    p.packaging = { weightGrams: numOrNull(el.packWeight.value), dims };
    return p;
  }

  async function renderInsight() {
    const draft = readForm();
    const merged = profiles.resolveProfile(draft.id, list.map((x) => (x.id === draft.id ? draft : x))) || draft;
    const box = $('#profile-insight');
    const rows = [];
    const log = await storage.get('shippingLog');
    const table = shipping.rateTable(log, settings.shipping);
    const weight = Number(merged.fields.weight);
    let shipEstimate = null;
    if (weight > 0) {
      const category = merged.category || 'Uncategorised';
      // The log is keyed by the declared net weight the panel sees, so look it up the same way.
      const est = shipping.estimateCharge(weight, category, table, settings.shipping);
      shipEstimate = est.amount;
      rows.push(
        shipEstimate == null
          ? 'No logged shipping charge yet for this category and weight slab. It appears after the panel calculates a price.'
          : `Expected shipping ≈ ₹${shipEstimate} (${est.source === 'observed' ? 'median from your log' : 'from fallback rates'}).`,
      );
      if (merged.packaging.weightGrams != null || merged.packaging.dims) {
        const packed = shipping.chargeableGrams(weight + (Number(merged.packaging.weightGrams) || 0), merged.packaging.dims, settings.shipping);
        const adv = shipping.advise(packed, category, table, settings.shipping);
        rows.push(`Packed chargeable weight ${packed} g: courier slab ${adv.position.index}, ${adv.position.headroomGrams} g headroom.`);
        for (const t of adv.tips) rows.push(t.message);
      }
    }
    const price = Number(merged.fields.meeshoPrice);
    if (price > 0 && merged.costs.costPrice != null) {
      const input = { price, productGstPct: Number(merged.fields.gst) || 0, shippingCharge: shipEstimate || 0, costPrice: merged.costs.costPrice, packagingCost: merged.costs.packagingCost };
      const b = pricing.breakdown(input, settings.fees);
      rows.push(
        `At ₹${price}: settlement ₹${b.settlement}, profit ₹${b.profit} (${b.marginPct}%), customer pays ₹${b.customerPays}` +
          (shipEstimate == null ? ' plus shipping (not known yet).' : '.'),
      );
      if (merged.costs.targetProfit != null) {
        const need = pricing.priceForTarget(merged.costs.targetProfit, input, settings.fees);
        if (need) rows.push(`Price for ₹${merged.costs.targetProfit} profit: ₹${need}.`);
      }
    }
    box.hidden = !rows.length;
    box.replaceChildren(h('strong', null, 'Insight'), h('ul', null, rows.map((r) => h('li', null, r))));
    const v = profiles.validateProfile(merged);
    $('#profile-validation').replaceChildren(
      ...v.errors.map((e) => h('div', { className: 'err' }, e)),
      ...v.warnings.map((w) => h('div', { className: 'warn' }, w)),
    );
  }

  form.addEventListener('input', () => renderInsight());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = readForm();
    await storage.upsertProfile(p);
    list = await storage.get('profiles');
    edit(p.id);
  });
  $('#new-profile').addEventListener('click', async () => {
    const p = profiles.createProfile({ name: 'New profile' });
    await storage.upsertProfile(p);
    list = await storage.get('profiles');
    edit(p.id);
  });
  $('#duplicate-profile').addEventListener('click', async () => {
    const src = readForm();
    const p = profiles.createProfile(Object.assign({}, src, { id: null, name: src.name + ' copy' }));
    await storage.upsertProfile(p);
    list = await storage.get('profiles');
    edit(p.id);
  });
  $('#delete-profile').addEventListener('click', async () => {
    if (!currentId || !confirm('Delete this profile? Profiles that inherit from it keep their own values.')) return;
    await storage.deleteProfile(currentId);
    list = await storage.get('profiles');
    edit(null);
  });
  $('#queue-profile').addEventListener('click', async () => {
    if (!currentId) return;
    const q = await storage.get('queue');
    q.items.push(currentId);
    await storage.set('queue', q);
    $('#profile-validation').append(h('div', { className: 'ok' }, `Added to queue (${q.items.length} items).`));
  });

  // ---------- queue ----------
  async function renderQueue() {
    const q = await storage.get('queue');
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    $('#queue-list').replaceChildren(
      ...q.items.map((id, i) =>
        h(
          'li',
          null,
          (byId[id] ? byId[id].name : 'Deleted profile') + (i < q.index ? ' (done)' : i === q.index ? ' (next)' : ''),
          ' ',
          h('button', { onclick: async () => { q.items.splice(i, 1); if (q.index > i) q.index -= 1; await storage.set('queue', q); renderQueue(); } }, 'Remove'),
        ),
      ),
    );
    if (!q.items.length) $('#queue-list').append(h('li', null, 'Empty. Use "Add to queue" on a profile.'));
  }
  $('#queue-reset').addEventListener('click', async () => {
    const q = await storage.get('queue');
    q.index = 0;
    await storage.set('queue', q);
    renderQueue();
  });
  $('#queue-clear').addEventListener('click', async () => {
    await storage.set('queue', { items: [], index: 0 });
    renderQueue();
  });

  // ---------- shipping log ----------
  async function renderShipping() {
    const log = await storage.get('shippingLog');
    const table = shipping.rateTable(log, settings.shipping);
    const slabSize = (settings.shipping && settings.shipping.slabSizeGrams) || shipping.DEFAULT_CONFIG.slabSizeGrams;
    const rateRows = [];
    for (const [cat, slabs] of Object.entries(table)) {
      for (const [slab, s] of Object.entries(slabs)) {
        rateRows.push(h('tr', null, h('td', null, cat), h('td', null, `${(slab - 1) * slabSize + 1}–${slab * slabSize} g`), h('td', null, s.count), h('td', null, `₹${s.min}`), h('td', null, `₹${s.median}`), h('td', null, `₹${s.max}`)));
      }
    }
    $('#rate-table').replaceChildren(
      rateRows.length
        ? h('div', { className: 'table-wrap' }, h('table', null, h('tr', null, ...['Category', 'Declared weight', 'Seen', 'Min', 'Median', 'Max'].map((t) => h('th', null, t))), ...rateRows))
        : h('p', { className: 'hint' }, 'Nothing logged yet.'),
    );
    const recent = log.slice(-50).reverse();
    $('#log-table').replaceChildren(
      recent.length
        ? h(
            'div',
            { className: 'table-wrap' },
            h(
              'table',
              null,
              h('tr', null, ...['When', 'Category', 'Weight (g)', 'Price', 'Shipping', 'Settlement'].map((t) => h('th', null, t))),
              ...recent.map((o) => h('tr', null, h('td', null, new Date(o.ts).toLocaleString()), h('td', null, o.category), h('td', null, o.weightGrams ?? '–'), h('td', null, `₹${o.price}`), h('td', null, `₹${o.charge}`), h('td', null, o.settlement == null ? '–' : `₹${o.settlement}`))),
            ),
          )
        : '',
    );
  }
  $('#log-export').addEventListener('click', async () => {
    const log = await storage.get('shippingLog');
    const cols = ['ts', 'category', 'weightGrams', 'price', 'charge', 'settlement', 'profileId'];
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [cols.join(','), ...log.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n');
    download('shipping-log.csv', csv, 'text/csv');
  });
  $('#log-clear').addEventListener('click', async () => {
    if (!confirm('Clear all logged shipping charges?')) return;
    await storage.set('shippingLog', []);
    renderShipping();
  });

  // ---------- settings ----------
  const sform = $('#settings-form');
  function fillSettings() {
    const f = Object.assign({}, pricing.DEFAULT_FEES, settings.fees);
    const s = Object.assign({}, shipping.DEFAULT_CONFIG, settings.shipping);
    const rm = Object.assign({}, shipping.DEFAULT_CONFIG.rateModel, s.rateModel);
    const el = sform.elements;
    for (const k of ['commissionPct', 'fixedFeePerOrder', 'gstOnFeesPct', 'tcsPct', 'tdsPct']) el[k].value = f[k];
    el.taxBaseIncludesShipping.checked = !!f.taxBaseIncludesShipping;
    el.shippingBorneBySeller.checked = !!f.shippingBorneBySeller;
    el.slabSizeGrams.value = s.slabSizeGrams;
    el.volumetricDivisor.value = s.volumetricDivisor;
    el.firstSlab.value = rm.firstSlab;
    el.additionalSlab.value = rm.additionalSlab;
    el.overwriteFilled.checked = !!settings.overwriteFilled;
    el.autoLogShipping.checked = !!settings.autoLogShipping;
    el.selectorOverrides.value = JSON.stringify(settings.selectorOverrides || {}, null, 2);
    el.shippingPatterns.value = (settings.shippingPatterns || []).join('\n');
  }
  sform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = sform.elements;
    const status = $('#settings-status');
    let overrides;
    try {
      overrides = JSON.parse(el.selectorOverrides.value || '{}');
      if (typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('must be an object');
    } catch (err) {
      status.replaceChildren(h('div', { className: 'err' }, 'Selector overrides are not valid JSON: ' + err.message));
      return;
    }
    const patterns = el.shippingPatterns.value.split('\n').map((s) => s.trim()).filter(Boolean);
    for (const p of patterns) {
      try {
        new RegExp(p);
      } catch (err) {
        status.replaceChildren(h('div', { className: 'err' }, 'Invalid pattern: ' + p));
        return;
      }
    }
    settings = Object.assign({}, settings, {
      fees: {
        commissionPct: Number(el.commissionPct.value) || 0,
        fixedFeePerOrder: Number(el.fixedFeePerOrder.value) || 0,
        gstOnFeesPct: Number(el.gstOnFeesPct.value) || 0,
        tcsPct: Number(el.tcsPct.value) || 0,
        tdsPct: Number(el.tdsPct.value) || 0,
        taxBaseIncludesShipping: el.taxBaseIncludesShipping.checked,
        shippingBorneBySeller: el.shippingBorneBySeller.checked,
      },
      shipping: {
        slabSizeGrams: Number(el.slabSizeGrams.value) || shipping.DEFAULT_CONFIG.slabSizeGrams,
        volumetricDivisor: Number(el.volumetricDivisor.value) || shipping.DEFAULT_CONFIG.volumetricDivisor,
        rateModel: { firstSlab: Number(el.firstSlab.value) || 0, additionalSlab: Number(el.additionalSlab.value) || 0 },
      },
      overwriteFilled: el.overwriteFilled.checked,
      autoLogShipping: el.autoLogShipping.checked,
      selectorOverrides: overrides,
      shippingPatterns: patterns,
    });
    await storage.set('settings', settings);
    status.replaceChildren(h('div', { className: 'ok' }, 'Saved.'));
  });

  // ---------- backup ----------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('#export-profiles').addEventListener('click', () => download('listing-profiles.json', profiles.exportProfiles(list), 'application/json'));
  $('#import-profiles').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const status = $('#backup-status');
    if (!file) return;
    try {
      const imported = profiles.importProfiles(await file.text());
      const byId = new Map(list.map((p) => [p.id, p]));
      for (const p of imported) byId.set(p.id, p);
      list = Array.from(byId.values());
      await storage.set('profiles', list);
      status.replaceChildren(h('div', { className: 'ok' }, `Imported ${imported.length} profiles.`));
      renderList();
    } catch (err) {
      status.replaceChildren(h('div', { className: 'err' }, 'Import failed: ' + err.message));
    }
    e.target.value = '';
  });

  renderList();
  fillSettings();
  if (list.length) edit(list[0].id);
})();

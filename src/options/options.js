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
      if (btn.dataset.tab === 'calc') initCalc();
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
    el.skip.value = (p.skip || []).join(', ');
    el.locked.value = (p.locked || []).join(', ');
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
    const keys = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
    p.skip = keys(el.skip.value);
    p.locked = keys(el.locked.value);
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


  // ---------- shipping calculator ----------
  const cform = $('#calc-form');
  let calcReady = false;
  async function initCalc() {
    const [log, categoryInfo] = await Promise.all([storage.get('shippingLog'), storage.get('categoryInfo')]);
    const ids = new Set([...Object.keys(categoryInfo), ...log.map((o) => o.category).filter((c) => c && c !== 'Uncategorised')]);
    $('#known-categories').replaceChildren(...[...ids].map((id) => h('option', { value: id }, categoryInfo[id] && categoryInfo[id].baseShipping != null ? `base ₹${categoryInfo[id].baseShipping}` : '')));
    cform.elements.profile.replaceChildren(h('option', { value: '' }, 'None'), ...list.map((p) => h('option', { value: p.id }, p.name)));
    if (!calcReady) {
      calcReady = true;
      cform.addEventListener('input', (e) => {
        if (e.target.name === 'profile') return;
        renderCalc();
      });
      cform.elements.profile.addEventListener('change', () => {
        const p = profiles.resolveProfile(cform.elements.profile.value, list);
        if (!p) return;
        const el = cform.elements;
        const set = (name, v) => { if (v != null && v !== '') el[name].value = v; };
        set('category', p.category);
        set('weight', p.fields.weight);
        set('price', p.fields.meeshoPrice);
        set('mrp', p.fields.mrp);
        set('gst', p.fields.gst);
        set('costPrice', p.costs.costPrice);
        set('packagingCost', p.costs.packagingCost);
        set('targetProfit', p.costs.targetProfit);
        set('packWeight', p.packaging.weightGrams);
        const d = p.packaging.dims || {};
        set('packL', d.length); set('packB', d.breadth); set('packH', d.height);
        renderCalc();
      });
    }
    renderCalc();
  }

  async function renderCalc() {
    const el = cform.elements;
    const n = (name) => (el[name].value === '' ? null : Number(el[name].value));
    const [log, categoryInfo] = await Promise.all([storage.get('shippingLog'), storage.get('categoryInfo')]);
    const box = $('#calc-result');
    const est = n('shipOverride') != null
      ? { amount: n('shipOverride'), source: 'override', low: n('shipOverride'), high: n('shipOverride'), samples: 0 }
      : shipping.estimateForListing({ categoryId: el.category.value.trim() || null, declaredGrams: n('weight') }, { log, categoryInfo, config: settings.shipping });
    const rows = [];
    const sourceText = est.source === 'override' ? 'your override' : shipping.SOURCE_LABELS[est.source];
    if (!n('price')) {
      box.replaceChildren(h('p', { className: 'hint' }, 'Enter at least a Meesho price. Add the category id to use the shipping you have seen for it.'));
      $('#calc-ladder').replaceChildren();
      return;
    }
    const input = {
      price: n('price'), mrp: n('mrp'), productGstPct: n('gst') || 0,
      shippingCharge: est.amount || 0, costPrice: n('costPrice'), packagingCost: n('packagingCost'),
      returnRatePct: n('returnRate'), returnCostPerOrder: n('returnCost'), targetProfit: n('targetProfit'),
    };
    const q = pricing.quote(input, settings.fees);
    const money = (v) => (v == null ? '–' : `₹${v}`);
    const kv = (k, v, cls) => [h('span', { className: cls || '' }, k), h('span', { className: cls || '' }, v)];
    box.replaceChildren(
      h('div', null, 'Estimated shipping'),
      h('div', { className: 'big' }, est.amount == null ? 'Not known yet' : money(est.amount) + (est.low !== est.high ? `  (₹${est.low} to ₹${est.high})` : '')),
      h('p', { className: 'hint' }, `Source: ${sourceText}${est.samples ? `, ${est.samples} logged` : ''}. Meesho finalises shipping from the product image match and packaging; list once to see the exact figure.`),
      h(
        'div',
        { className: 'kv' },
        kv('Meesho price', money(q.price)),
        kv('Shipping (paid by customer)', money(est.amount)),
        kv('Customer pays', money(q.customerPays), 'total'),
        kv('Commission', money(q.commission)),
        kv('Tax deducted (GST on fees, TCS, TDS)', money(q.taxesShown)),
        kv('Bank settlement', money(q.settlement), 'total'),
        kv('GST you owe on the sale', money(q.netGstPayable)),
        kv('Cost + packaging', money((input.costPrice || 0) + (input.packagingCost || 0))),
        kv('Profit per order', `${money(q.profit)} (${q.marginPct}%)`, 'total'),
        input.returnRatePct ? kv('Expected profit with returns', money(q.expectedProfit)) : null,
        q.priceForTarget ? kv(`Price for ₹${input.targetProfit} profit`, money(q.priceForTarget)) : null,
      ),
      ...q.warnings.map((w) => h('div', { className: 'warn' }, w)),
    );
    if (n('weight')) {
      const packed = shipping.chargeableGrams(n('weight') + (n('packWeight') || 0), [n('packL'), n('packB'), n('packH')].every((v) => v) ? { length: n('packL'), breadth: n('packB'), height: n('packH') } : null, settings.shipping);
      const adv = shipping.advise(packed, el.category.value.trim() || 'Uncategorised', shipping.rateTable(log, settings.shipping), settings.shipping);
      box.append(h('p', { className: 'hint' }, `Packed chargeable weight ${packed} g (courier slab ${adv.position.index}, ${adv.position.headroomGrams} g headroom).`), ...adv.tips.map((t) => h('div', { className: 'warn' }, t.message)));
    }
    const ladder = pricing.priceLadder(input, settings.fees, { steps: 5, step: input.price >= 500 ? 50 : 20 });
    $('#calc-ladder').replaceChildren(
      h('div', { className: 'table-wrap' }, h('table', null,
        h('tr', null, ...['Meesho price', 'Customer pays', 'Settlement', 'Profit', 'Margin'].map((t) => h('th', null, t))),
        ...ladder.map((r) => h('tr', { className: r.current ? 'current' : '' }, h('td', null, money(r.price)), h('td', null, money(r.customerPays)), h('td', null, money(r.settlement)), h('td', null, money(r.profit)), h('td', null, r.marginPct + '%'))),
      )),
    );
  }

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
    el.gstEnrolmentOnly.checked = !!f.gstEnrolmentOnly;
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
        gstEnrolmentOnly: el.gstEnrolmentOnly.checked,
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

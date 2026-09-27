/*
 * Content-script entry point for the supplier panel (isolated world).
 */
(function (root) {
  'use strict';

  if (window.top !== window || root.__msaStarted) return;
  root.__msaStarted = true;

  const { storage, profiles, autofill, validator, shippingWatch, shipping, pricing, scanner, panel, capture, toolbar } = root.MSA;

  const state = {
    profiles: [],
    activeProfileId: null,
    settings: null,
    queue: { items: [], index: 0 },
    lastTransfer: null, // latest normalised transfer price seen on this page
    lastCategoryId: null, // sub-sub-category id from the panel's own price request
    previousCharge: null,
  };

  async function selectProfile(id) {
    state.activeProfileId = id || null;
    await storage.set('activeProfileId', state.activeProfileId);
  }

  function say(text, cls) {
    ui.setMessage(text, cls);
    bar.setMessage(text, cls);
  }

  /** Save the current form as a new profile, or into an existing one. */
  async function saveFromForm(targetId) {
    const captured = capture.captureForm(document, { selectorOverrides: state.settings.selectorOverrides });
    if (!captured.count) {
      say('Nothing to save yet. Fill the form first.', 'warn');
      return null;
    }
    let profile;
    if (targetId) {
      const existing = state.profiles.find((p) => p.id === targetId);
      if (!existing) return null;
      if (!window.confirm(`Update "${existing.name}" with the ${captured.count} values in this form? Saved values not on this page, costs and packaging are kept.`)) return null;
      profile = profiles.mergeCaptured(existing, captured);
    } else {
      const name = window.prompt('Name for this profile', capture.suggestName(captured));
      if (name === null) return null;
      profile = profiles.createProfile({
        name: name.trim() || capture.suggestName(captured),
        category: state.lastCategoryId || '',
        fields: captured.fields,
        attributes: captured.attributes,
      });
    }
    if (!profile.category && state.lastCategoryId) profile.category = state.lastCategoryId;
    await storage.upsertProfile(profile);
    await selectProfile(profile.id);
    say(`Saved ${captured.count} values to "${profile.name}".`, 'ok');
    return profile;
  }

  const ui = panel.mount({
    onFill: () => fillWith(state.activeProfileId),
    onCheck: runCheck,
    onSelectProfile: selectProfile,
    onSaveNew: () => saveFromForm(null),
    onQueueNext: fillNextInQueue,
    onOpenOptions: () => chrome.runtime.sendMessage({ type: 'MSA_OPEN_OPTIONS' }),
  });

  const bar = toolbar.mount({
    onFill: (id) => fillWith(id || state.activeProfileId),
    onSaveNew: () => saveFromForm(null),
    onUpdate: (id) => saveFromForm(id),
    onSelect: selectProfile,
  });

  function resolved(id) {
    return id ? profiles.resolveProfile(id, state.profiles) : null;
  }

  async function load() {
    const [list, activeId, settings, queue] = await Promise.all([
      storage.get('profiles'),
      storage.get('activeProfileId'),
      storage.get('settings'),
      storage.get('queue'),
    ]);
    Object.assign(state, { profiles: list, activeProfileId: activeId, settings, queue });
    ui.setProfiles(list, activeId);
    bar.setProfiles(list, activeId);
    ui.setQueue(queue, Object.fromEntries(list.map((p) => [p.id, p])));
  }

  async function fillWith(id) {
    const profile = resolved(id);
    if (!profile) {
      if (!bar.isAttached()) ui.open();
      say('Choose a profile first.', 'warn');
      return null;
    }
    say('Filling…');
    const report = await autofill.fill(document, profile, {
      overwrite: !!state.settings.overwriteFilled,
      selectorOverrides: state.settings.selectorOverrides,
    });
    ui.setFillReport(report);
    const summary = `Filled ${report.filled.length}` + (report.failed.length ? `, ${report.failed.length} failed` : '') + '. Review, then submit.';
    bar.setMessage(summary, report.failed.length ? 'warn' : 'ok');
    runCheck();
    return report;
  }

  async function fillNextInQueue() {
    const q = state.queue;
    if (!q.items.length || q.index >= q.items.length) {
      ui.setMessage('Queue is empty or finished.', 'muted');
      return;
    }
    const report = await fillWith(q.items[q.index]);
    if (report) {
      q.index += 1;
      await storage.set('queue', q);
      ui.setQueue(q, Object.fromEntries(state.profiles.map((p) => [p.id, p])));
    }
  }

  function runCheck() {
    const res = validator.check(document, {
      profile: resolved(state.activeProfileId),
      transferPrice: state.lastTransfer,
      fees: state.settings.fees,
      selectorOverrides: state.settings.selectorOverrides,
    });
    ui.setCheck(res);
    return res;
  }

  async function shippingView(tp, category) {
    const profile = resolved(state.activeProfileId);
    const view = Object.assign({}, tp, { previous: state.previousCharge, profit: null, tips: [] });
    if (profile && profile.costs.costPrice != null) {
      const b = pricing.breakdown(
        {
          price: tp.price,
          productGstPct: profile.fields.gst,
          shippingCharge: tp.shippingCharge,
          costPrice: profile.costs.costPrice,
          packagingCost: profile.costs.packagingCost,
        },
        state.settings.fees,
      );
      view.profit = b.profit;
    }
    const formWeight = pricing.parseAmount(scanner.readValues(scanner.scan(document)).fields.weight, NaN);
    if (profile && Number.isFinite(formWeight) && profile.packaging.weightGrams != null) {
      const packed = shipping.chargeableGrams(formWeight + Number(profile.packaging.weightGrams), profile.packaging.dims, state.settings.shipping);
      const table = shipping.rateTable(await storage.get('shippingLog'), state.settings.shipping);
      view.tips = shipping.advise(packed, category, table, state.settings.shipping).tips.map((t) => t.message);
    }
    return view;
  }

  function formNumbers() {
    const v = scanner.readValues(scanner.scan(document, { selectorOverrides: state.settings.selectorOverrides })).fields;
    const n = (x) => {
      const r = pricing.parseAmount(x, NaN);
      return Number.isFinite(r) ? r : null;
    };
    return { price: n(v.meeshoPrice), mrp: n(v.mrp), gst: n(v.gst), weight: n(v.weight) };
  }

  /** Our own estimate, shown until (and alongside) the panel's calculation. */
  async function estimateView(categoryId) {
    const f = formNumbers();
    const [log, categoryInfo] = await Promise.all([storage.get('shippingLog'), storage.get('categoryInfo')]);
    const est = shipping.estimateForListing(
      { categoryId, declaredGrams: f.weight },
      { log, categoryInfo, config: state.settings.shipping },
    );
    if (est.amount == null || !f.price) return null;
    const profile = resolved(state.activeProfileId);
    const q = pricing.quote(
      {
        price: f.price,
        mrp: f.mrp,
        productGstPct: f.gst != null ? f.gst : profile && profile.fields.gst,
        shippingCharge: est.amount,
        costPrice: profile && profile.costs.costPrice,
        packagingCost: profile && profile.costs.packagingCost,
      },
      state.settings.fees,
    );
    const range = est.low !== est.high ? ` (₹${est.low} to ₹${est.high})` : '';
    return {
      price: q.price,
      shippingCharge: est.amount,
      customerPays: q.customerPays,
      settlement: q.settlement,
      profit: profile && profile.costs.costPrice != null ? q.profit : null,
      note: `Estimate${range}: ${shipping.SOURCE_LABELS[est.source]}. The panel's own figure replaces this when it calculates.`,
      tips: q.warnings,
    };
  }

  window.addEventListener('message', async (event) => {
    const msg = shippingWatch.readObserverMessage(event, window);
    if (!msg) return;
    if (msg.kind === 'productSchema') {
      if (msg.categoryId) state.lastCategoryId = msg.categoryId;
      await storage.rememberCategory(msg.categoryId || state.lastCategoryId, { baseShipping: msg.baseShipping, wdrpMaxPct: msg.wdrpMaxPct });
      if (!state.lastTransfer) {
        const view = await estimateView(state.lastCategoryId);
        if (view) ui.setShipping(view);
      }
      return;
    }
    const tp = msg.transferPrice;
    if (state.lastTransfer) state.previousCharge = state.lastTransfer.shippingCharge;
    state.lastTransfer = tp;
    if (msg.request.subSubCategoryId) state.lastCategoryId = msg.request.subSubCategoryId;
    const profile = resolved(state.activeProfileId);
    const category = msg.request.subSubCategoryId || state.lastCategoryId || (profile && profile.category) || 'Uncategorised';
    const view = await shippingView(tp, category);
    const mrp = formNumbers().mrp;
    view.tips = pricing.quote({ price: tp.price, mrp, shippingCharge: tp.shippingCharge }, state.settings.fees).warnings
      .filter((w) => !/^Loss/.test(w))
      .concat(view.tips || []);
    view.note = "Panel's own calculation.";
    ui.setShipping(view);
    if (state.settings.autoLogShipping) {
      const weight = formNumbers().weight;
      await storage.appendShippingObservation({
        category,
        weightGrams: weight,
        price: tp.price,
        charge: tp.shippingCharge,
        settlement: tp.settlement,
        profileId: state.activeProfileId,
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id) return false;
    if (msg.type === 'MSA_FILL') {
      fillWith(msg.profileId || state.activeProfileId).then((r) => sendResponse({ ok: !!r, report: r }));
      return true;
    }
    if (msg.type === 'MSA_CAPTURE') {
      saveFromForm(null).then((p) => sendResponse({ ok: !!p, name: p && p.name }));
      return true;
    }
    if (msg.type === 'MSA_ESTIMATE') {
      estimateView(state.lastCategoryId).then((v) => sendResponse({ ok: !!v, view: v }));
      return true;
    }
    if (msg.type === 'MSA_STATUS') {
      const res = scanner.scan(document);
      sendResponse({ ok: true, detected: Object.keys(res.byKey), lastTransfer: state.lastTransfer });
      return false;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.profiles || changes.settings || changes.queue || changes.activeProfileId)) load();
  });

  load();
})(globalThis);

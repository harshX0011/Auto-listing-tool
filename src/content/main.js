/*
 * Content-script entry point for the supplier panel (isolated world).
 */
(function (root) {
  'use strict';

  if (window.top !== window || root.__msaStarted) return;
  root.__msaStarted = true;

  const { storage, profiles, autofill, validator, shippingWatch, shipping, pricing, scanner, panel } = root.MSA;

  const state = {
    profiles: [],
    activeProfileId: null,
    settings: null,
    queue: { items: [], index: 0 },
    lastTransfer: null, // latest normalised transfer price seen on this page
    previousCharge: null,
  };

  const ui = panel.mount({
    onFill: () => fillWith(state.activeProfileId),
    onCheck: runCheck,
    onSelectProfile: async (id) => {
      state.activeProfileId = id || null;
      await storage.set('activeProfileId', state.activeProfileId);
    },
    onQueueNext: fillNextInQueue,
    onOpenOptions: () => chrome.runtime.sendMessage({ type: 'MSA_OPEN_OPTIONS' }),
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
    ui.setQueue(queue, Object.fromEntries(list.map((p) => [p.id, p])));
  }

  async function fillWith(id) {
    const profile = resolved(id);
    if (!profile) {
      ui.open();
      ui.setMessage('Choose a profile first.', 'warn');
      return null;
    }
    ui.setMessage('Filling…');
    const report = await autofill.fill(document, profile, {
      overwrite: !!state.settings.overwriteFilled,
      selectorOverrides: state.settings.selectorOverrides,
    });
    ui.setFillReport(report);
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

  window.addEventListener('message', async (event) => {
    const msg = shippingWatch.readObserverMessage(event, window);
    if (!msg) return;
    const tp = msg.transferPrice;
    if (state.lastTransfer) state.previousCharge = state.lastTransfer.shippingCharge;
    state.lastTransfer = tp;
    const profile = resolved(state.activeProfileId);
    const category = msg.request.subSubCategoryId || (profile && profile.category) || 'Uncategorised';
    ui.setShipping(await shippingView(tp, category));
    if (state.settings.autoLogShipping) {
      const weight = pricing.parseAmount(scanner.readValues(scanner.scan(document)).fields.weight, NaN);
      await storage.appendShippingObservation({
        category,
        weightGrams: Number.isFinite(weight) ? weight : null,
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

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const dom = require('../src/content/dom');
const scanner = require('../src/content/scanner');
const autofill = require('../src/content/autofill');
const validator = require('../src/content/validator');
const shippingWatch = require('../src/content/shipping-watch');
const profiles = require('../src/lib/profiles');

// A form shaped like the panel: labels are sibling <div>s, not <label for>,
// and dropdowns are custom listboxes.
const FORM = `
<form>
  <div class="field"><div class="lbl">Product Name *</div><div><input type="text" /></div></div>
  <div class="field"><div class="lbl">Meesho Price *</div><div><input type="number" required /></div></div>
  <div class="field"><div class="lbl">Wrong / Defective Return Discount(₹)</div><div><input type="number" /></div></div>
  <div class="field"><div class="lbl">MRP *</div><div><input type="number" /></div></div>
  <div class="field"><div class="lbl">Net Weight (gms) *</div><div><input type="number" value="150" /></div></div>
  <div class="field"><label for="gst">GST</label><select id="gst"><option value="">Select</option><option value="5">5</option><option value="18">18</option></select></div>
  <div class="field"><div class="lbl">Color *</div>
    <div><input readonly role="combobox" aria-controls="color-list" placeholder="Select" /></div>
  </div>
  <div class="field"><div class="lbl">Images</div><div><input type="file" /></div></div>
  <div class="field" style="display:none"><div class="lbl">Brand</div><input /></div>
</form>
<ul id="color-list" role="listbox" hidden></ul>
`;

function setup() {
  const jsdom = new JSDOM(`<!doctype html><body>${FORM}</body>`);
  const doc = jsdom.window.document;
  // Emulate a custom dropdown: clicking the trigger renders options; clicking an option sets the value.
  const trigger = doc.querySelector('[role=combobox]');
  const listbox = doc.getElementById('color-list');
  trigger.addEventListener('click', () => {
    listbox.hidden = false;
    listbox.innerHTML = '<li role="option">Black</li><li role="option">Blue</li>';
    for (const li of listbox.children) {
      li.addEventListener('click', () => {
        trigger.value = li.textContent;
        listbox.hidden = true;
      });
    }
  });
  return { jsdom, doc };
}

test('getLabelText reads sibling labels, <label for> and placeholders', () => {
  const { doc } = setup();
  const inputs = doc.querySelectorAll('input, select');
  assert.equal(dom.getLabelText(inputs[0]), 'Product Name *');
  assert.equal(dom.getLabelText(doc.getElementById('gst')), 'GST');
});

test('scanner maps controls, skips hidden ones and reports kinds', () => {
  const { doc } = setup();
  const res = scanner.scan(doc, { attributeNames: ['Color'] });
  assert.deepEqual(Object.keys(res.byKey).sort(), ['gst', 'meeshoPrice', 'mrp', 'productName', 'wdrpDiscount', 'weight'].sort());
  assert.equal(res.byKey.gst.kind, 'select');
  assert.equal(res.byAttribute.Color.kind, 'combobox');
  assert.equal(res.byKey.brand, undefined, 'hidden field must be skipped');
});

test('setNativeValue fires input and change events', () => {
  const { doc } = setup();
  const el = doc.querySelector('input');
  const seen = [];
  el.addEventListener('input', () => seen.push('input'));
  el.addEventListener('change', () => seen.push('change'));
  dom.setNativeValue(el, 'Hello');
  assert.equal(el.value, 'Hello');
  assert.deepEqual(seen, ['input', 'change']);
});

test('fill types text, selects options, keeps existing values and never touches files', async () => {
  const { doc } = setup();
  const profile = profiles.createProfile({
    fields: { productName: 'Earbuds {{Color}}', meeshoPrice: 499, mrp: 1999, weight: 200, gst: '18', brand: 'Acme' },
    attributes: { Color: 'Black', Images: 'x.png' },
  });
  const r = await autofill.fill(doc, profile, { delayMs: 0 });
  const vals = scanner.readValues(scanner.scan(doc, { attributeNames: ['Color'] }));
  assert.equal(vals.fields.productName, 'Earbuds Black');
  assert.equal(vals.fields.meeshoPrice, '499');
  assert.equal(vals.fields.gst, '18');
  assert.equal(vals.attributes.Color, 'Black');
  assert.equal(vals.fields.weight, '150', 'existing value kept without overwrite');
  assert.ok(r.skipped.some((s) => s.name === 'weight'));
  assert.ok(r.notFound.includes('brand'));
  assert.ok(r.failed.some((f) => f.name === 'Images' && /file/.test(f.reason)));
});

test('fill with overwrite replaces existing values and reports missing options', async () => {
  const { doc } = setup();
  const profile = profiles.createProfile({ fields: { weight: 210, gst: '12' }, attributes: { Color: 'Purple' } });
  const r = await autofill.fill(doc, profile, { overwrite: true, delayMs: 0 });
  assert.equal(scanner.readValues(scanner.scan(doc)).fields.weight, '210');
  assert.ok(r.failed.some((f) => f.name === 'gst'));
  assert.ok(r.failed.some((f) => f.name === 'Color'));
});

test('selector overrides take precedence over label matching', () => {
  const { doc } = setup();
  doc.querySelectorAll('input')[1].setAttribute('data-x', 'price');
  const res = scanner.scan(doc, { selectorOverrides: { mrp: '[data-x=price]', productName: '[[bad' } });
  assert.equal(res.byKey.mrp.el.getAttribute('data-x'), 'price');
});

test('validator reports required, price and profit problems', () => {
  const { doc } = setup();
  const inputs = doc.querySelectorAll('input');
  dom.setNativeValue(inputs[1], '600');
  dom.setNativeValue(inputs[3], '500');
  dom.setNativeValue(inputs[2], '250');
  doc.getElementById('gst').value = '18';
  const res = validator.check(doc, {
    profile: { costs: { costPrice: 650, packagingCost: 10, targetProfit: 50 } },
    transferPrice: { shippingCharge: 70, customerPays: 670, settlement: 596 },
  });
  assert.ok(res.errors.some((e) => /Required: Product Name/.test(e)));
  assert.ok(res.errors.some((e) => /higher than MRP/.test(e)));
  assert.ok(res.errors.some((e) => /Loss of/.test(e)));
  assert.ok(res.warnings.some((w) => /42% of price/.test(w)));
  assert.ok(res.info.some((i) => /Shipping ₹70/.test(i)));
});

test('observer messages are accepted only from the same window with the right source', () => {
  const { jsdom } = setup();
  const win = jsdom.window;
  const data = {
    source: 'msa-page-observer',
    kind: 'transferPrice',
    request: { price: 999, sscat_id: 1234, gst_percentage: 18 },
    response: { price: 999, tcs: 4.64, tds: 0.93, transfer_price: 993.44, shipping_charges: 95, total_price: 1094 },
  };
  const ok = shippingWatch.readObserverMessage({ source: win, data }, win);
  assert.equal(ok.transferPrice.shippingCharge, 95);
  assert.equal(ok.request.subSubCategoryId, '1234');
  assert.equal(shippingWatch.readObserverMessage({ source: {}, data }, win), null);
  assert.equal(shippingWatch.readObserverMessage({ source: win, data: Object.assign({}, data, { source: 'evil' }) }, win), null);
});

test('text fallback finds the shipping charge', () => {
  const { doc } = setup();
  doc.body.insertAdjacentHTML('beforeend', '<div>Shipping Charges <span>₹ 95</span> (paid by customer)</div>');
  const storage = require('../src/lib/storage');
  const hit = shippingWatch.findChargeInText(doc.body, storage.DEFAULTS.settings.shippingPatterns);
  assert.equal(hit.amount, 95);
  assert.equal(shippingWatch.findChargeInText(doc.body, ['(']), null);
});

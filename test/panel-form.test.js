'use strict';
/*
 * A fixture that mirrors the structure of the supplier panel's add-catalog
 * form as observed (MUI text fields, "Select" dropdown triggers that open a
 * [role=menu] with a Search box and [role=menuitem] rows, a size multi-select,
 * and a size-wise price grid with <h6> column headers). Tests the full loop:
 * type into form -> capture profile -> fill a fresh form.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const dom = require('../src/content/dom');
const scanner = require('../src/content/scanner');
const autofill = require('../src/content/autofill');
const capture = require('../src/content/capture');
const profiles = require('../src/lib/profiles');

const BRANDS = Array.from({ length: 60 }, (_, i) => `Brand ${i + 1}`).concat(['100 Takaa']);

const HTML = `<!doctype html><body><div id="app">
  <h3>Add Product Details</h3>
  <div class="grid">
    <div class="f"><p>GST *</p><div role="combobox" data-options="0,5,18"><input id="mui-1" placeholder="Select" /></div></div>
    <div class="f"><p>HSN Code *</p><div role="combobox" data-options="85183000,8518"><input id="mui-2" placeholder="Select" /></div></div>
    <div class="f"><label id="product_weight_in_gms-label" for="product_weight_in_gms">Net Weight (gms) *</label>
      <div><input id="product_weight_in_gms" type="number" aria-describedby="product_weight_in_gms-helper-text" /></div><p id="product_weight_in_gms-helper-text"></p></div>
    <div class="f"><label for="supplier_product_id">Style code/ Product ID (optional)</label><input id="supplier_product_id" /></div>
    <div class="f"><label for="product_name">Product Name *</label><input id="product_name" /></div>
    <div class="f"><p>Size *</p><div role="combobox" data-options="S,M,L,Free Size" data-multi="1"><input id="mui-3" placeholder="Select" /></div></div>
  </div>
  <div class="table">
    <div class="row head"><h6>Size</h6><h6>Meesho Price*</h6><h6>Wrong / Defective Return Discount(₹)</h6><h6>MRP*</h6><h6>Inventory*</h6><h6>Actions</h6></div>
    <div class="row"><div>S</div><div><input id="meesho_price" type="number" aria-describedby="meesho_price-helper-text" /></div><div><input id="wdrp_discount" type="number" /></div><div><input id="product_mrp" type="number" /></div><div><input id="inventory" type="number" /></div><div><button>Delete</button></div></div>
    <div class="row"><div>M</div><div><input id="meesho_price" type="number" aria-describedby="meesho_price-helper-text" /></div><div><input id="wdrp_discount" type="number" /></div><div><input id="product_mrp" type="number" /></div><div><input id="inventory" type="number" /></div><div><button>Delete</button></div></div>
  </div>
  <div class="grid">
    <div class="f"><p>Color *</p><div role="combobox" data-options="Black,Blue,White"><input id="mui-4" placeholder="Select" /></div></div>
    <div class="f"><p>Play Time *</p><div role="combobox" data-options="1 Hours,10 Hours,12 Hours"><input id="mui-5" placeholder="Select" /></div></div>
    <div class="f"><p>Brand</p><div role="combobox" data-options="${BRANDS.join(',')}" data-search="1"><input id="mui-6" placeholder="Select" /></div></div>
    <div class="f"><label for="manufacturer_name">Manufacturer Name *</label><input id="manufacturer_name" /></div>
    <div class="f"><label for="packer_name">Packer Name *</label><input id="packer_name" disabled /></div>
    <div class="f"><p>Included Components *</p><input id="mui-7" /></div>
    <div class="f"><p>Images</p><input type="file" /></div>
  </div>
</div></body>`;

/** Behaves like the panel's dropdown: opens a menu portal, optional search, multi-select stays open. */
function wireDropdowns(doc) {
  const win = doc.defaultView;
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
  for (const box of doc.querySelectorAll('[role=combobox]')) {
    const input = box.querySelector('input');
    const all = box.dataset.options.split(',');
    const multi = !!box.dataset.multi;
    const searchable = !!box.dataset.search;
    let menu = null;
    const close = () => { if (menu) { menu.remove(); menu = null; } };
    const render = (query) => {
      const list = menu.querySelector('ul');
      const shown = all.filter((o) => !query || o.toLowerCase().includes(query.toLowerCase())).slice(0, searchable && !query ? 10 : 999);
      list.replaceChildren(...shown.map((o) => {
        const li = doc.createElement('li');
        li.setAttribute('role', 'menuitem');
        li.innerHTML = `<p>${o}</p>`;
        li.addEventListener('click', () => {
          if (multi) {
            const cur = input.value ? input.value.split(', ') : [];
            if (!cur.includes(o)) cur.push(o);
            setter.call(input, cur.join(', '));
          } else {
            setter.call(input, o);
            close();
          }
        });
        return li;
      }));
    };
    input.addEventListener('mousedown', () => {
      if (menu) return;
      menu = doc.createElement('div');
      menu.setAttribute('role', 'menu');
      menu.innerHTML = (searchable ? '<input placeholder="Search" />' : '') + '<ul></ul>';
      doc.body.append(menu);
      if (searchable) menu.querySelector('input').addEventListener('input', (e) => render(e.target.value));
      menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      render('');
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
}

function freshForm() {
  const jsdom = new JSDOM(HTML);
  const doc = jsdom.window.document;
  wireDropdowns(doc);
  return doc;
}

const PROFILE_VALUES = {
  fields: {
    gst: '18', hsn: '85183000', weight: '99', productName: 'Premium Bluetooth Earbuds',
    meeshoPrice: '999', wdrpDiscount: '10', mrp: '1999', inventory: '50', manufacturerName: 'Acme Audio',
  },
  attributes: { Size: 'S, M', Color: 'Black', 'Play Time': '12 Hours', Brand: '100 Takaa', 'Included Components': 'Charging Cable and ear plugs' },
};

test('labels: <p> siblings, MUI label ids, and <h6> grid column headers', () => {
  const doc = freshForm();
  const res = scanner.scan(doc, { attributeNames: ['Size', 'Color', 'Play Time', 'Brand', 'Included Components'] });
  assert.equal(res.byKey.gst.kind, 'combobox');
  assert.equal(res.byKey.weight.el.id, 'product_weight_in_gms');
  assert.equal(res.allByKey.meeshoPrice.length, 2, 'one price input per size row');
  assert.equal(res.allByKey.wdrpDiscount.length, 2);
  assert.equal(res.byAttribute['Play Time'].kind, 'combobox');
  assert.equal(res.byKey.packerName, undefined, 'disabled fields are ignored');
});

test('fill a fresh form: dropdowns, search box, multi-select sizes and every size row', async () => {
  const doc = freshForm();
  const profile = profiles.createProfile(PROFILE_VALUES);
  const r = await autofill.fill(doc, profile, { delayMs: 0 });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.notFound, []);
  const byId = (id) => Array.from(doc.querySelectorAll('#' + id)).map((e) => e.value);
  assert.equal(doc.getElementById('mui-1').value, '18');
  assert.equal(doc.getElementById('mui-2').value, '85183000');
  assert.equal(doc.getElementById('mui-3').value, 'S, M');
  assert.equal(doc.getElementById('mui-5').value, '12 Hours');
  assert.equal(doc.getElementById('mui-6').value, '100 Takaa', 'found through the search box');
  assert.deepEqual(byId('meesho_price'), ['999', '999']);
  assert.deepEqual(byId('product_mrp'), ['1999', '1999']);
  assert.equal(doc.getElementById('mui-7').value, 'Charging Cable and ear plugs');
  assert.equal(doc.querySelectorAll('[role=menu]').length, 0, 'no dropdown left open');
});

test('capture reads the filled form back into the same profile data', async () => {
  const doc = freshForm();
  await autofill.fill(doc, profiles.createProfile(PROFILE_VALUES), { delayMs: 0 });
  doc.getElementById('supplier_product_id').value = 'SKU-123';
  const c = capture.captureForm(doc);
  // Brand is a known field, so capture files it under fields.brand.
  const { Brand, ...otherAttributes } = PROFILE_VALUES.attributes;
  assert.deepEqual(c.fields, Object.assign({}, PROFILE_VALUES.fields, { brand: Brand }));
  assert.deepEqual(c.attributes, otherAttributes);
  assert.equal(c.fields.styleCode, undefined, 'per-listing ids are not captured');
  assert.equal(c.count, 14);
});

test('capture then fill round-trip into a second form', async () => {
  const first = freshForm();
  await autofill.fill(first, profiles.createProfile(PROFILE_VALUES), { delayMs: 0 });
  const saved = profiles.createProfile(capture.captureForm(first));
  const second = freshForm();
  const r = await autofill.fill(second, saved, { delayMs: 0 });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(capture.captureForm(second), capture.captureForm(first));
});

test('skip keeps a field out of Auto Fill; locked keeps it out of Update', async () => {
  const doc = freshForm();
  const p = profiles.createProfile(Object.assign({}, PROFILE_VALUES, { skip: ['inventory'], locked: ['meeshoPrice'] }));
  await autofill.fill(doc, p, { delayMs: 0 });
  assert.equal(doc.getElementById('inventory').value, '');
  const merged = profiles.mergeCaptured(p, { fields: { meeshoPrice: '1', mrp: '2500' }, attributes: { Color: 'Blue', Wattage: '10 W' } });
  assert.equal(merged.fields.meeshoPrice, '999');
  assert.equal(merged.fields.mrp, '2500');
  assert.equal(merged.fields.gst, '18', 'values not on the page are kept');
  assert.equal(merged.attributes.Color, 'Blue');
  assert.equal(merged.attributes.Wattage, '10 W');
});

test('ambiguous prefixes never pick an option', () => {
  const doc = new JSDOM('<ul><li>10 W</li><li>100 W</li><li>1 Hours</li></ul>').window.document;
  const lis = Array.from(doc.querySelectorAll('li'));
  assert.equal(dom.pickOption(lis, '10'), null);
  assert.equal(dom.pickOption(lis, '1 hours'), lis[2]);
  assert.equal(dom.pickOption(lis, '100'), lis[1]);
});

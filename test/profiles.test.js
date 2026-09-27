'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = require('../src/lib/profiles');

const base = profiles.createProfile({
  id: 'base', name: 'Brand defaults',
  fields: { gst: '18', countryOfOrigin: 'India', manufacturerName: 'Acme', manufacturerPincode: '110001' },
  costs: { packagingCost: 8 },
});
const child = profiles.createProfile({
  id: 'child', name: 'Earbuds black', extends: 'base',
  fields: { productName: 'Wireless Earbuds {{Color}}', meeshoPrice: 499, mrp: 1999, gst: '' },
  attributes: { Color: 'Black' },
  costs: { costPrice: 250 },
});

test('resolveProfile merges ancestors with child values winning and blanks ignored', () => {
  const r = profiles.resolveProfile('child', [base, child]);
  assert.equal(r.fields.gst, '18');
  assert.equal(r.fields.countryOfOrigin, 'India');
  assert.equal(r.fields.meeshoPrice, 499);
  assert.equal(r.costs.packagingCost, 8);
  assert.equal(r.costs.costPrice, 250);
  assert.equal(r.name, 'Earbuds black');
});

test('resolveProfile survives inheritance cycles and missing ids', () => {
  const a = profiles.createProfile({ id: 'a', name: 'A', extends: 'b', fields: { mrp: 1 } });
  const b = profiles.createProfile({ id: 'b', name: 'B', extends: 'a', fields: { mrp: 2 } });
  assert.equal(profiles.resolveProfile('a', [a, b]).fields.mrp, 1);
  assert.equal(profiles.resolveProfile('zzz', [a, b]), null);
});

test('templates render from attributes and fields', () => {
  const r = profiles.resolveProfile('child', [base, child]);
  assert.equal(profiles.renderValues(r).fields.productName, 'Wireless Earbuds Black');
  assert.equal(profiles.renderTemplate('A {{missing}} B', r), 'A B');
});

test('validateProfile catches the mistakes the panel would reject', () => {
  const bad = profiles.createProfile({
    fields: { meeshoPrice: 600, mrp: 500, hsn: '12345', gst: '7', wdrpDiscount: 700, manufacturerPincode: '12345', bogus: 1 },
  });
  const v = profiles.validateProfile(bad);
  assert.ok(v.errors.some((e) => /higher than MRP/.test(e)));
  assert.ok(v.errors.some((e) => /HSN/.test(e)));
  assert.ok(v.errors.some((e) => /discount/.test(e)));
  assert.ok(v.errors.some((e) => /pincode/.test(e)));
  assert.ok(v.warnings.some((w) => /GST 7%/.test(w)));
  assert.ok(v.warnings.some((w) => /bogus/.test(w)));
  assert.deepEqual(profiles.validateProfile(profiles.resolveProfile('child', [base, child])), { errors: [], warnings: [] });
});

test('export and import round-trip keeps ids and links', () => {
  const back = profiles.importProfiles(profiles.exportProfiles([base, child]));
  assert.equal(back.length, 2);
  assert.equal(back[1].extends, 'base');
  assert.throws(() => profiles.importProfiles('{"nope":1}'), /No profiles/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fields = require('../src/lib/fields');

test('labels seen in the panel schema map to canonical keys', () => {
  const cases = {
    'Product Name': 'productName',
    'Meesho Price *': 'meeshoPrice',
    'MRP': 'mrp',
    'Inventory': 'inventory',
    'Net Weight (gms)': 'weight',
    'Wrong / Defective Return Discount(₹)': 'wdrpDiscount',
    'Style code/ Product ID (optional)': 'styleCode',
    'SKU ID (optional)': 'skuId',
    'GST': 'gst',
    'HSN Code': 'hsn',
    'COUNTRY OF ORIGIN': 'countryOfOrigin',
    'Manufacturer Name': 'manufacturerName',
    'Manufacturer Address': 'manufacturerAddress',
    'Manufacturer Pincode': 'manufacturerPincode',
    'Packer Pincode': 'packerPincode',
    'Importer Address': 'importerAddress',
    'Net Quantity (N)': 'netQuantity',
    'Description': 'description',
    'Brand': 'brand',
  };
  for (const [label, key] of Object.entries(cases)) {
    assert.equal(fields.matchLabel(label) && fields.matchLabel(label).key, key, label);
  }
});

test('category attributes are not claimed by generic fields', () => {
  for (const label of ['Color', 'Product Length (cm)', 'Bluetooth Range', 'Warranty Period']) {
    assert.equal(fields.matchLabel(label), null, label);
  }
});

test('identifiers in name/id attributes match strongly', () => {
  assert.deepEqual(fields.matchIdentifier('0:0:meesho_price'), { key: 'meeshoPrice', score: 500 });
  assert.equal(fields.matchIdentifier('product_mrp').key, 'mrp');
  assert.equal(fields.matchIdentifier('random'), null);
});

test('attribute matching prefers the closest name', () => {
  assert.equal(fields.matchAttribute('Color *', ['Color', 'Colour Family']).name, 'Color');
  assert.equal(fields.matchAttribute('Fabric', ['Color']), null);
});

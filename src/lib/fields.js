/*
 * Canonical listing fields and label matching.
 *
 * The Meesho Supplier Panel renders its listing form with generated class
 * names that change between releases, so we never depend on them. Instead we
 * read the human-visible label of every input and map it to a canonical key.
 */
(function (root) {
  'use strict';

  // Order matters only for documentation; matching is score based.
  // Labels and identifiers observed in the panel's single-catalog form schema
  // (see docs/REFERENCE_ANALYSIS.md). Identifiers are also matched against an
  // input's name/id attributes when the panel exposes them.
  const FIELD_DEFS = [
    { key: 'productName', label: 'Product Name', type: 'text', ids: ['product_name'], synonyms: ['product name'] },
    { key: 'meeshoPrice', label: 'Meesho Price', type: 'number', ids: ['meesho_price'], synonyms: ['meesho price', 'selling price'] },
    {
      key: 'wdrpDiscount',
      type: 'number',
      ids: ['wdrp_discount'],
      synonyms: ['wrong defective return discount', 'wrong defective returns discount', 'wrong defective return discount ₹'],
    },
    { key: 'mrp', label: 'MRP', type: 'number', ids: ['product_mrp'], synonyms: ['mrp', 'maximum retail price'] },
    { key: 'inventory', label: 'Inventory', type: 'number', ids: ['inventory'], synonyms: ['inventory', 'stock'] },
    { key: 'weight', label: 'Net Weight (gms)', type: 'number', ids: ['product_weight_in_gms'], synonyms: ['net weight gms', 'net weight', 'product weight', 'weight'] },
    { key: 'styleCode', label: 'Style Code / Product ID', type: 'text', ids: ['supplier_product_id'], synonyms: ['style code product id', 'style code', 'product id'] },
    { key: 'skuId', label: 'SKU ID', type: 'text', ids: ['supplier_sku_id'], synonyms: ['sku id', 'sku'] },
    { key: 'gst', label: 'GST (%)', type: 'select', ids: ['supplier_gst_percent'], synonyms: ['gst', 'gst rate'] },
    { key: 'hsn', label: 'HSN Code', type: 'select', ids: ['hsn_code'], synonyms: ['hsn code', 'hsn'] },
    { key: 'brand', label: 'Brand', type: 'select', ids: ['brand'], synonyms: ['brand', 'brand name'] },
    { key: 'countryOfOrigin', label: 'Country of Origin', type: 'select', ids: ['country_of_origin'], synonyms: ['country of origin'] },
    { key: 'manufacturerName', label: 'Manufacturer Name', type: 'text', ids: ['manufacturer_name'], synonyms: ['manufacturer name'] },
    { key: 'manufacturerAddress', label: 'Manufacturer Address', type: 'text', ids: ['manufacturer_address'], synonyms: ['manufacturer address'] },
    { key: 'manufacturerPincode', label: 'Manufacturer Pincode', type: 'number', ids: ['manufacturer_pincode'], synonyms: ['manufacturer pincode'] },
    { key: 'packerName', label: 'Packer Name', type: 'text', ids: ['packer_name'], synonyms: ['packer name'] },
    { key: 'packerAddress', label: 'Packer Address', type: 'text', ids: ['packer_address'], synonyms: ['packer address'] },
    { key: 'packerPincode', label: 'Packer Pincode', type: 'number', ids: ['packer_pincode'], synonyms: ['packer pincode'] },
    { key: 'importerName', label: 'Importer Name', type: 'text', ids: ['importer_name'], synonyms: ['importer name'] },
    { key: 'importerAddress', label: 'Importer Address', type: 'text', ids: ['importer_address'], synonyms: ['importer address'] },
    { key: 'importerPincode', label: 'Importer Pincode', type: 'text', ids: ['importer_pincode'], synonyms: ['importer pincode'] },
    { key: 'description', label: 'Description', type: 'textarea', ids: ['comment'], synonyms: ['product description', 'description'] },
    { key: 'netQuantity', label: 'Net Quantity (N)', type: 'select', ids: ['multipack'], synonyms: ['net quantity n', 'net quantity'] },
    { key: 'modelName', label: 'Model Name', type: 'text', ids: ['model_name'], synonyms: ['model name'] },
  ];

  const FIELD_KEYS = FIELD_DEFS.map((d) => d.key);

  function normalizeLabel(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/\(.*?\)/g, (m) => ' ' + m.slice(1, -1) + ' ') // keep "(gm)" content as words
      .replace(/[*:?_/\\|,.\-–]+/g, ' ')
      .replace(/[^a-z0-9%₹ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function containsPhrase(haystack, phrase) {
    return (' ' + haystack + ' ').includes(' ' + phrase + ' ');
  }

  /**
   * Score how well a normalized label matches a normalized synonym.
   * Longer synonyms win ties so "meesho price" beats "price".
   */
  function scorePhrase(label, synonym) {
    if (!label || !synonym) return 0;
    if (label === synonym) return 100 + synonym.length;
    if (label.startsWith(synonym + ' ')) return 80 + synonym.length;
    if (containsPhrase(label, synonym)) return 60 + synonym.length;
    return 0;
  }

  /** Best canonical key for a label, or null. */
  function matchLabel(rawLabel) {
    const label = normalizeLabel(rawLabel);
    let best = null;
    for (const def of FIELD_DEFS) {
      for (const syn of def.synonyms) {
        const score = scorePhrase(label, normalizeLabel(syn));
        if (score > 0 && (!best || score > best.score)) best = { key: def.key, score };
      }
    }
    return best;
  }

  /** Match a label against user-defined attribute names (e.g. "Color", "Fabric"). */
  function matchAttribute(rawLabel, attributeNames) {
    const label = normalizeLabel(rawLabel);
    let best = null;
    for (const name of attributeNames) {
      const score = scorePhrase(label, normalizeLabel(name));
      if (score > 0 && (!best || score > best.score)) best = { name, score };
    }
    return best;
  }

  /**
   * Match an input's name/id attribute against known schema identifiers.
   * Accepts composite names such as "0:0:meesho_price".
   */
  function matchIdentifier(attr) {
    if (!attr) return null;
    const parts = String(attr).toLowerCase().split(/[^a-z0-9_]+/);
    for (const def of FIELD_DEFS) {
      if (def.ids.some((id) => parts.includes(id))) return { key: def.key, score: 500 };
    }
    return null;
  }

  function getFieldDef(key) {
    return FIELD_DEFS.find((d) => d.key === key) || null;
  }

  const api = { FIELD_DEFS, FIELD_KEYS, normalizeLabel, scorePhrase, matchLabel, matchIdentifier, matchAttribute, getFieldDef };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MSA = root.MSA || {}).fields = api;
})(globalThis);

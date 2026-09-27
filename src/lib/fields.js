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
  const FIELD_DEFS = [
    { key: 'productName', type: 'text', synonyms: ['product name', 'name of the product'] },
    { key: 'meeshoPrice', type: 'number', synonyms: ['meesho price', 'selling price', 'price'] },
    {
      key: 'wrongDefectiveReturnsPrice',
      type: 'number',
      synonyms: ['wrong defective returns price', 'wrong or defective returns price', 'returns price'],
    },
    { key: 'mrp', type: 'number', synonyms: ['mrp', 'maximum retail price', 'product mrp'] },
    { key: 'inventory', type: 'number', synonyms: ['inventory', 'stock', 'available quantity'] },
    { key: 'weight', type: 'number', synonyms: ['product weight', 'weight in gm', 'weight gm', 'weight'] },
    { key: 'skuId', type: 'text', synonyms: ['supplier product id', 'sku id', 'sku', 'style code'] },
    { key: 'gst', type: 'select', synonyms: ['gst', 'gst rate', 'gst percentage'] },
    { key: 'hsn', type: 'text', synonyms: ['hsn code', 'hsn'] },
    { key: 'brand', type: 'text', synonyms: ['brand name', 'brand'] },
    { key: 'countryOfOrigin', type: 'select', synonyms: ['country of origin'] },
    { key: 'manufacturerDetails', type: 'textarea', synonyms: ['manufacturer details', 'manufacturer name and address'] },
    { key: 'packerDetails', type: 'textarea', synonyms: ['packer details', 'packer name and address'] },
    { key: 'importerDetails', type: 'textarea', synonyms: ['importer details', 'importer name and address'] },
    { key: 'description', type: 'textarea', synonyms: ['product description', 'description'] },
    { key: 'netQuantity', type: 'select', synonyms: ['net quantity', 'net qty'] },
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

  function getFieldDef(key) {
    return FIELD_DEFS.find((d) => d.key === key) || null;
  }

  const api = { FIELD_DEFS, FIELD_KEYS, normalizeLabel, scorePhrase, matchLabel, matchAttribute, getFieldDef };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MSA = root.MSA || {}).fields = api;
})(globalThis);

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../src/lib/storage');

test('defaults are returned as copies and settings merge with defaults', async () => {
  storage._resetMemory();
  const a = await storage.get('profiles');
  a.push(1);
  assert.deepEqual(await storage.get('profiles'), []);
  await storage.set('settings', { overwriteFilled: true });
  const s = await storage.get('settings');
  assert.equal(s.overwriteFilled, true);
  assert.equal(s.autoLogShipping, true);
});

test('profile upsert and delete unlink children', async () => {
  storage._resetMemory();
  await storage.upsertProfile({ id: 'base', name: 'Base' });
  await storage.upsertProfile({ id: 'kid', name: 'Kid', extends: 'base' });
  await storage.upsertProfile({ id: 'kid', name: 'Kid 2', extends: 'base' });
  assert.equal((await storage.get('profiles')).length, 2);
  await storage.deleteProfile('base');
  const list = await storage.get('profiles');
  assert.deepEqual(list.map((p) => [p.id, p.name, p.extends]), [['kid', 'Kid 2', null]]);
});

test('shipping observations are de-duplicated and capped', async () => {
  storage._resetMemory();
  await storage.set('settings', { maxLogEntries: 3 });
  const obs = { category: 'X', weightGrams: 100, price: 200, charge: 60 };
  assert.equal(await storage.appendShippingObservation(obs), true);
  assert.equal(await storage.appendShippingObservation(obs), false);
  for (let i = 0; i < 5; i++) await storage.appendShippingObservation(Object.assign({}, obs, { price: 300 + i }));
  const log = await storage.get('shippingLog');
  assert.equal(log.length, 3);
  assert.equal(log[2].price, 304);
});

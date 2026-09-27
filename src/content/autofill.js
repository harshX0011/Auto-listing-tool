/*
 * Types a resolved profile into the detected form controls.
 *
 * Human in the loop by design: we fill, the seller reviews and clicks the
 * panel's own submit button. We never submit and never touch image uploads.
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const dom = isNode ? require('./dom') : root.MSA.dom;
  const scanner = isNode ? require('./scanner') : root.MSA.scanner;
  const profiles = isNode ? require('../lib/profiles') : root.MSA.profiles;

  async function fillControl(control, value) {
    const { el, kind } = control;
    if (kind === 'file') return { ok: false, reason: 'file inputs are left to the seller' };
    if (kind === 'select') {
      return dom.selectNative(el, value) ? { ok: true } : { ok: false, reason: `no option "${value}"` };
    }
    if (kind === 'combobox') {
      return (await dom.selectCustom(el, value)) ? { ok: true } : { ok: false, reason: `no option "${value}"` };
    }
    dom.setNativeValue(el, value);
    const now = dom.currentValue(el);
    // Number inputs may reformat ("499.00"), so compare numerically when possible.
    const same = now === String(value) || (now !== '' && Number(now) === Number(value));
    return same ? { ok: true } : { ok: false, reason: 'value did not stick' };
  }

  /**
   * @param {ParentNode} scope
   * @param {object} profile resolved profile (see profiles.resolveProfile)
   * @param {{overwrite?:boolean, selectorOverrides?:object, delayMs?:number}} [opts]
   */
  async function fill(scope, profile, opts) {
    const o = Object.assign({ overwrite: false, delayMs: 60 }, opts);
    const values = profiles.renderValues(profile);
    const result = scanner.scan(scope, {
      selectorOverrides: o.selectorOverrides,
      attributeNames: Object.keys(values.attributes),
    });
    const report = { filled: [], skipped: [], failed: [], notFound: [] };

    const jobs = [];
    for (const [key, value] of Object.entries(values.fields)) {
      if (value === '' || value == null) continue;
      const c = result.byKey[key];
      if (c) jobs.push({ name: key, control: c, value });
      else report.notFound.push(key);
    }
    for (const [name, value] of Object.entries(values.attributes)) {
      if (value === '' || value == null) continue;
      const c = result.byAttribute[name];
      if (c) jobs.push({ name, control: c, value });
      else report.notFound.push(name);
    }

    for (const job of jobs) {
      const existing = dom.currentValue(job.control.el);
      if (existing && !o.overwrite) {
        report.skipped.push({ name: job.name, reason: 'already has a value', existing });
        continue;
      }
      try {
        const res = await fillControl(job.control, job.value);
        if (res.ok) report.filled.push({ name: job.name, value: job.value });
        else report.failed.push({ name: job.name, reason: res.reason });
      } catch (e) {
        report.failed.push({ name: job.name, reason: String((e && e.message) || e) });
      }
      // Dependent fields (e.g. size charts) often render after a change.
      if (o.delayMs) await dom.sleep(o.delayMs);
    }
    return report;
  }

  const api = { fill, fillControl };
  if (isNode) module.exports = api;
  else (root.MSA = root.MSA || {}).autofill = api;
})(globalThis);

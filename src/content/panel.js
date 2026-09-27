/*
 * Floating assistant panel rendered in a closed shadow root so the panel's
 * styles and ours never collide.
 */
(function (root) {
  'use strict';

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 48px; height: 48px;
      border-radius: 50%; border: 0; background: #5b2a86; color: #fff; font: 600 13px/1 system-ui;
      box-shadow: 0 4px 14px rgba(0,0,0,.25); cursor: pointer; }
    .panel { position: fixed; right: 16px; bottom: 72px; z-index: 2147483647; width: 340px; max-height: 75vh;
      overflow: auto; background: #fff; color: #1d1d1f; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
      font-size: 13px; line-height: 1.4; }
    .panel[hidden] { display: none; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;
      background: #5b2a86; color: #fff; border-radius: 12px 12px 0 0; font-weight: 600; }
    header button { background: transparent; border: 0; color: #fff; cursor: pointer; font-size: 16px; }
    section { padding: 10px 12px; border-bottom: 1px solid #eee; }
    h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b6b70; }
    select, button.act { width: 100%; padding: 7px 8px; border-radius: 8px; border: 1px solid #ccc; font-size: 13px; background: #fff; }
    .row { display: flex; gap: 6px; margin-top: 6px; }
    .row button.act { flex: 1; cursor: pointer; }
    button.primary { background: #5b2a86; color: #fff; border-color: #5b2a86; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; } td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #6b6b70; font-size: 12px; }
    ul { margin: 4px 0 0; padding-left: 18px; }
    .err { color: #b00020; } .warn { color: #8a5a00; } .ok { color: #1b7f3b; }
    a { color: #5b2a86; }
  `;

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  function set(el, ...kids) {
    el.replaceChildren(...kids.flat().filter((k) => k != null));
  }

  function list(items, cls) {
    return items.length ? h('ul', { class: cls }, items.map((t) => h('li', null, t))) : null;
  }

  /**
   * @param {object} handlers {onFill, onCheck, onSelectProfile, onQueueNext, onOpenOptions}
   */
  function mount(handlers) {
    const host = h('div', { id: 'msa-root' });
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(h('style', null, STYLE));

    const profileSelect = h('select', { onchange: () => handlers.onSelectProfile(profileSelect.value) });
    const fillStatus = h('div', { class: 'muted' });
    const queueInfo = h('div', { class: 'muted' });
    const shipBox = h('div', { class: 'muted' }, 'Waiting for the panel to calculate price details…');
    const checkBox = h('div');

    const panel = h(
      'div',
      { class: 'panel', hidden: true },
      h('header', null, 'Listing Assistant', h('button', { title: 'Close', onclick: () => (panel.hidden = true) }, '×')),
      h(
        'section',
        null,
        h('h4', null, 'Profile'),
        profileSelect,
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'act primary', onclick: handlers.onFill }, 'Fill form'),
          h('button', { class: 'act', onclick: handlers.onCheck }, 'Check'),
        ),
        h('div', { class: 'row' }, h('button', { class: 'act', onclick: handlers.onSaveNew }, 'Save this form as a profile')),
        fillStatus,
      ),
      h(
        'section',
        null,
        h('h4', null, 'Queue'),
        queueInfo,
        h('div', { class: 'row' }, h('button', { class: 'act', onclick: handlers.onQueueNext }, 'Fill next in queue')),
      ),
      h('section', null, h('h4', null, 'Shipping and payout'), shipBox),
      h('section', null, h('h4', null, 'Checklist'), checkBox),
      h('section', null, h('a', { href: '#', onclick: (e) => (e.preventDefault(), handlers.onOpenOptions()) }, 'Manage profiles and settings')),
    );
    const fab = h('button', { class: 'fab', title: 'Listing Assistant', onclick: () => (panel.hidden = !panel.hidden) }, 'SLA');
    shadow.append(fab, panel);
    document.documentElement.append(host);

    return {
      open() {
        panel.hidden = false;
      },
      setProfiles(profiles, activeId) {
        set(profileSelect,
          h('option', { value: '' }, profiles.length ? 'Choose a profile' : 'No profiles yet'),
          ...profiles.map((p) => h('option', { value: p.id, selected: p.id === activeId }, p.name)),
        );
      },
      setQueue(queue, profilesById) {
        const total = queue.items.length;
        if (!total) return set(queueInfo, 'Queue is empty. Add profiles to it from the settings page.');
        const next = profilesById[queue.items[queue.index]];
        set(queueInfo,
          queue.index >= total ? `All ${total} done.` : `Next ${queue.index + 1} of ${total}: ${next ? next.name : 'missing profile'}`,
        );
      },
      setFillReport(r) {
        const parts = [`Filled ${r.filled.length}`];
        if (r.skipped.length) parts.push(`kept ${r.skipped.length} existing`);
        if (r.failed.length) parts.push(`failed ${r.failed.length}`);
        if (r.notFound.length) parts.push(`not on page ${r.notFound.length}`);
        set(fillStatus,
          h('div', { class: r.failed.length ? 'warn' : 'ok' }, parts.join(', ') + '. Review, then submit yourself.'),
          list(r.failed.map((f) => `${f.name}: ${f.reason}`), 'warn'),
          r.notFound.length ? h('div', { class: 'muted' }, 'Not found: ' + r.notFound.join(', ')) : null,
        );
      },
      setMessage(text, cls) {
        set(fillStatus, h('div', { class: cls || 'muted' }, text));
      },
      setShipping(view) {
        if (!view) return;
        const rows = [
          ['Meesho price', view.price],
          ['Shipping (customer pays)', view.shippingCharge],
          ['Customer pays', view.customerPays],
          ['Settlement to you', view.settlement],
        ];
        if (view.profit != null) rows.push(['Profit after costs', view.profit]);
        set(shipBox,
          h('table', null, rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v == null ? '–' : `₹${v}`)))),
          view.note ? h('div', { class: 'muted' }, view.note) : null,
          list(view.tips || [], 'warn'),
          view.previous != null && view.previous !== view.shippingCharge
            ? h('div', { class: 'muted' }, `Previous calculation on this page: ₹${view.previous}`)
            : null,
        );
      },
      setCheck(res) {
        set(checkBox,
          res.errors.length || res.warnings.length ? null : h('div', { class: 'ok' }, 'No problems found.'),
          list(res.errors, 'err'),
          list(res.warnings, 'warn'),
          list(res.info, 'muted'),
        );
      },
    };
  }

  (root.MSA = root.MSA || {}).panel = { mount };
})(globalThis);

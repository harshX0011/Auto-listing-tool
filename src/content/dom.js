/*
 * DOM helpers that work with framework-controlled inputs (React and similar).
 *
 * Setting input.value directly does not update a React component's state, so
 * we call the native value setter and then dispatch the events a real user
 * would produce.
 */
(function (root) {
  'use strict';

  const INPUT_SELECTOR = [
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])',
    'textarea',
    'select',
    '[role=combobox]',
    '[contenteditable=true]',
  ].join(',');

  // Options inside an open popup. Bare <li> is only trusted inside a popup,
  // never page-wide, so we cannot click unrelated navigation links.
  const POPUP_SELECTOR = '[role=menu], [role=listbox]';
  const OPTION_IN_POPUP = '[role=option], [role=menuitem], li';
  const OPTION_PAGEWIDE = '[role=option], [role=menuitem]';

  function text(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function nativeSetter(el) {
    const win = el.ownerDocument.defaultView;
    const proto =
      el instanceof win.HTMLTextAreaElement
        ? win.HTMLTextAreaElement.prototype
        : el instanceof win.HTMLSelectElement
          ? win.HTMLSelectElement.prototype
          : win.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    return desc && desc.set;
  }

  function fire(el, type, init) {
    const win = el.ownerDocument.defaultView;
    const Ctor = type.startsWith('key') ? win.KeyboardEvent : type === 'input' ? win.InputEvent || win.Event : win.Event;
    el.dispatchEvent(new Ctor(type, Object.assign({ bubbles: true, cancelable: true }, init)));
  }

  function setNativeValue(el, value) {
    const str = value == null ? '' : String(value);
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.focus();
      el.textContent = str;
      fire(el, 'input');
      fire(el, 'blur');
      return true;
    }
    el.focus && el.focus();
    const setter = nativeSetter(el);
    // React tracks the last value it saw; resetting the tracker makes it notice.
    if (el._valueTracker) el._valueTracker.setValue('');
    if (setter) setter.call(el, str);
    else el.value = str;
    fire(el, 'input');
    fire(el, 'change');
    fire(el, 'blur');
    return true;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden], [aria-hidden=true]')) return false;
    const win = el.ownerDocument.defaultView;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = win.getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  function byIdText(doc, ids) {
    return ids
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)))
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Best-effort human label for a form control. Order: explicit <label>,
   * aria attributes, then nearby text in the surrounding field container.
   */
  function getLabelText(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      const lbl = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (text(lbl)) return text(lbl);
    }
    if (el.id) {
      const muiLabel = doc.getElementById(el.id + '-label');
      if (text(muiLabel)) return text(muiLabel);
    }
    const wrapping = el.closest('label');
    if (wrapping) {
      const t = text(wrapping).replace(text(el), '').trim();
      if (t) return t;
    }
    if (el.getAttribute('aria-labelledby')) {
      // MUI-style selects list their own id here, which would return the
      // selected value as the "label". Only use ids that point elsewhere.
      const ids = el
        .getAttribute('aria-labelledby')
        .split(/\s+/)
        .filter((id) => id && id !== el.id && !(doc.getElementById(id) && el.contains(doc.getElementById(id))));
      const t = byIdText(doc, ids.join(' '));
      if (t) return t;
    }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();

    // Grid/table layouts (the size-wise price table): the label is the
    // header cell in the same column of the first row.
    const header = columnHeader(el);
    if (header) return header;

    // Walk up a few levels looking for a short text block before the control.
    let node = el;
    for (let depth = 0; depth < 4 && node && node.parentElement; depth++) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (!sib.querySelector(INPUT_SELECTOR) && !sib.matches(INPUT_SELECTOR)) {
          const t = text(sib);
          if (t && t.length <= 80) return t;
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return (el.getAttribute('placeholder') || el.getAttribute('name') || '').trim();
  }

  function hasControl(node) {
    return node.matches(INPUT_SELECTOR) || !!node.querySelector(INPUT_SELECTOR);
  }

  function columnHeader(el) {
    let cell = el;
    for (let depth = 0; depth < 6 && cell && cell.parentElement; depth++) {
      const row = cell.parentElement;
      const grid = row.parentElement;
      if (grid && row !== grid.firstElementChild) {
        const head = grid.firstElementChild;
        const idx = Array.prototype.indexOf.call(row.children, cell);
        if (head.children.length === row.children.length && row.children.length > 2 && idx >= 0) {
          const hc = head.children[idx];
          const t = text(hc);
          if (t && t.length <= 60 && !hasControl(hc) && !hasControl(head)) return t;
        }
      }
      cell = row;
    }
    return '';
  }

  /** Stable field id: MUI text fields point aria-describedby at "<id>-helper-text". */
  function stableId(el) {
    const described = el.getAttribute('aria-describedby') || '';
    const m = /^(.+)-helper-text$/.exec(described);
    if (m && !m[1].startsWith('mui-')) return m[1];
    return el.id && !el.id.startsWith('mui-') ? el.id : '';
  }

  function cssEscape(s) {
    const css = globalThis.CSS;
    return css && css.escape ? css.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

  function controlKind(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
    if (el.getAttribute('contenteditable') === 'true') return 'richtext';
    if (tag === 'input' && el.type === 'file') return 'file';
    if (tag === 'input' && el.readOnly) return 'combobox'; // read-only inputs usually open a custom dropdown
    // The panel's dropdown trigger is an input with placeholder "Select" inside a combobox wrapper.
    if (tag === 'input' && (el.closest('[role=combobox]') || el.getAttribute('placeholder') === 'Select')) return 'combobox';
    return el.type === 'number' ? 'number' : 'text';
  }

  function currentValue(el) {
    const kind = controlKind(el);
    if (kind === 'select') {
      const opt = el.options[el.selectedIndex];
      return opt && opt.value !== '' ? text(opt) : '';
    }
    if (kind === 'richtext') return text(el);
    if (kind === 'combobox' && el.tagName.toLowerCase() !== 'input') {
      // MUI-style select: the real value sits in a hidden sibling input.
      const native = el.parentElement && el.parentElement.querySelector('input[aria-hidden="true"], input.MuiSelect-nativeInput');
      if (native) return String(native.value || '');
      return text(el).replace(/\u200b/g, '').trim();
    }
    if ('value' in el && el.value !== undefined && el.value !== null) return String(el.value);
    return text(el);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(fn, { timeout = 2000, interval = 50 } = {}) {
    const start = Date.now();
    for (;;) {
      const res = fn();
      if (res) return res;
      if (Date.now() - start >= timeout) return null;
      await sleep(interval);
    }
  }

  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function pickOption(options, wanted) {
    const w = normalize(wanted);
    const list = options.filter((o) => text(o));
    const exact =
      list.find((o) => normalize(text(o)) === w) ||
      list.find((o) => normalize(o.getAttribute('data-value') || o.getAttribute('value')) === w);
    if (exact) return exact;
    // A prefix match is only safe when it is unambiguous ("1" must not pick "10 W").
    const prefix = list.filter((o) => normalize(text(o)).startsWith(w));
    return prefix.length === 1 ? prefix[0] : null;
  }

  function selectNative(el, wanted) {
    const opts = Array.from(el.options);
    const w = normalize(wanted);
    const opt =
      opts.find((o) => normalize(o.textContent) === w) ||
      opts.find((o) => normalize(o.value) === w) ||
      opts.find((o) => normalize(o.textContent).startsWith(w));
    if (!opt) return false;
    setNativeValue(el, opt.value);
    return true;
  }

  function click(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const win = el.ownerDocument.defaultView;
      const Ctor = type.startsWith('pointer') && win.PointerEvent ? win.PointerEvent : win.MouseEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: win }));
    }
  }

  /**
   * Open a custom dropdown and click the option whose text matches.
   * Some dropdowns filter as you type, so we also type the value if the
   * option is not visible right away.
   */
  function openPopup(el) {
    const doc = el.ownerDocument;
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const owned = id ? doc.getElementById(id) : null;
    if (owned && isVisible(owned)) return owned;
    const open = Array.from(doc.querySelectorAll(POPUP_SELECTOR)).filter((p) => !p.contains(el) && isVisible(p));
    return open.length ? open[open.length - 1] : null;
  }

  function visibleOptions(el) {
    const popup = openPopup(el);
    const nodes = popup ? popup.querySelectorAll(OPTION_IN_POPUP) : el.ownerDocument.querySelectorAll(OPTION_PAGEWIDE);
    return Array.from(nodes).filter((o) => o !== el && !o.contains(el) && isVisible(o));
  }

  async function closePopup(el) {
    const popup = openPopup(el);
    if (!popup) return;
    for (const target of [popup, el.ownerDocument.activeElement, el]) if (target) fire(target, 'keydown', { key: 'Escape' });
    await waitFor(() => !popup.isConnected || !isVisible(popup), { timeout: 600 });
  }

  /** Pick one option in an already-open dropdown, using its search box if it has one. */
  async function pickInOpenDropdown(el, wanted, timeout) {
    const find = () => pickOption(visibleOptions(el), wanted);
    let opt = await waitFor(find, { timeout: timeout / 2 });
    if (!opt) {
      const popup = openPopup(el);
      // Type into the menu's own search box. Only type into the trigger when
      // no menu opened at all (a true autocomplete input).
      const search = popup && Array.from(popup.querySelectorAll('input')).find((i) => i !== el && isVisible(i));
      const typeInto = search || (!popup && el.tagName.toLowerCase() === 'input' && !el.readOnly ? el : null);
      if (typeInto) {
        setNativeValue(typeInto, wanted);
        opt = await waitFor(find, { timeout: timeout / 2 });
      }
    }
    if (!opt) return false;
    click(opt);
    return true;
  }

  /**
   * Open a custom dropdown and click the option whose text matches.
   * "S, M, L" is treated as a multi-select when no single option has that text.
   */
  async function selectCustom(el, wanted, { timeout = 1500 } = {}) {
    click(el);
    await waitFor(() => openPopup(el) || visibleOptions(el).length, { timeout: timeout / 2 });
    if (await pickInOpenDropdown(el, wanted, timeout)) {
      await waitFor(() => !openPopup(el), { timeout: 600 });
      await closePopup(el);
      return true;
    }
    const parts = String(wanted).split(',').map((x) => x.trim()).filter(Boolean);
    let ok = parts.length > 1;
    if (ok) {
      for (const part of parts) {
        if (!openPopup(el)) {
          click(el);
          await waitFor(() => openPopup(el), { timeout: timeout / 2 });
        }
        ok = (await pickInOpenDropdown(el, part, timeout)) && ok;
      }
    }
    await closePopup(el);
    return ok;
  }

  const api = {
    INPUT_SELECTOR,
    text,
    setNativeValue,
    isVisible,
    getLabelText,
    stableId,
    controlKind,
    currentValue,
    waitFor,
    sleep,
    selectNative,
    selectCustom,
    click,
    pickOption,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MSA = root.MSA || {}).dom = api;
})(globalThis);

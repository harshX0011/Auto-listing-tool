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

  const OPTION_SELECTOR = '[role=option], [role=menuitem], li, [class*=option i]';

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
    const wrapping = el.closest('label');
    if (wrapping) {
      const t = text(wrapping).replace(text(el), '').trim();
      if (t) return t;
    }
    if (el.getAttribute('aria-labelledby')) {
      const t = byIdText(doc, el.getAttribute('aria-labelledby'));
      if (t) return t;
    }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();

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
    return el.type === 'number' ? 'number' : 'text';
  }

  function currentValue(el) {
    const kind = controlKind(el);
    if (kind === 'select') {
      const opt = el.options[el.selectedIndex];
      return opt && opt.value !== '' ? text(opt) : '';
    }
    if (kind === 'richtext') return text(el);
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
    return (
      list.find((o) => normalize(text(o)) === w) ||
      list.find((o) => normalize(o.getAttribute('data-value') || o.getAttribute('value')) === w) ||
      list.find((o) => normalize(text(o)).startsWith(w)) ||
      null
    );
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
  async function selectCustom(el, wanted, { timeout = 1500 } = {}) {
    const doc = el.ownerDocument;
    const listboxFor = () => {
      const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      return id ? doc.getElementById(id) : null;
    };
    const findOption = () => {
      const scope = listboxFor();
      const nodes = Array.from((scope || doc).querySelectorAll(OPTION_SELECTOR)).filter(
        (o) => o !== el && !o.contains(el) && isVisible(o),
      );
      return pickOption(nodes, wanted);
    };

    click(el);
    let opt = await waitFor(findOption, { timeout: timeout / 2 });
    if (!opt && el.tagName.toLowerCase() === 'input' && !el.readOnly) {
      setNativeValue(el, wanted);
      el.focus();
      opt = await waitFor(findOption, { timeout: timeout / 2 });
    }
    if (!opt) {
      fire(el, 'keydown', { key: 'Escape' });
      return false;
    }
    click(opt);
    return true;
  }

  const api = {
    INPUT_SELECTOR,
    text,
    setNativeValue,
    isVisible,
    getLabelText,
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

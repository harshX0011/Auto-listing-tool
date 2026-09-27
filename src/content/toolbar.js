/*
 * Inline toolbar placed next to the form's "Add Product Details" heading:
 * profile picker, Auto Fill, and Save / Update from the current form.
 * Re-attaches itself when the single-page app re-renders.
 */
(function (root) {
  'use strict';

  const HEADING_TEXT = /^add product details$/i;

  const STYLE = `
    :host { all: initial; display: inline-flex; vertical-align: middle; margin-left: 12px; }
    * { box-sizing: border-box; font: 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .bar { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    select { height: 28px; min-width: 170px; max-width: 240px; padding: 0 6px; border: 1px solid #c9c9d1; border-radius: 6px; background: #fff; color: #1d1d1f; }
    button { height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid #c9c9d1; background: #fff; color: #1d1d1f; cursor: pointer; white-space: nowrap; }
    button.primary { background: #5b2a86; border-color: #5b2a86; color: #fff; font-weight: 600; }
    button:disabled { opacity: .5; cursor: default; }
    .msg { color: #6b6b70; max-width: 320px; }
    .msg.ok { color: #1b7f3b; } .msg.warn { color: #8a5a00; } .msg.err { color: #b00020; }
  `;

  function findHeading(doc) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (HEADING_TEXT.test(n.nodeValue.trim())) return n.parentElement;
    }
    return null;
  }

  /**
   * @param {{onFill:Function, onSaveNew:Function, onUpdate:Function, onSelect:Function}} handlers
   */
  function mount(handlers) {
    const doc = document;
    const host = doc.createElement('span');
    host.id = 'msa-toolbar';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = STYLE;

    const select = doc.createElement('select');
    select.title = 'Profile';
    select.addEventListener('change', () => {
      handlers.onSelect(select.value || null);
      update.disabled = !select.value;
    });
    const mk = (label, cls, title, fn) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      b.title = title;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
      return b;
    };
    const fill = mk('Auto Fill', 'primary', 'Fill this form from the selected profile', () => handlers.onFill(select.value || null));
    const saveNew = mk('Save as profile', '', 'Save the details typed in this form as a new profile', () => handlers.onSaveNew());
    const update = mk('Update', '', 'Overwrite the selected profile with this form', () => handlers.onUpdate(select.value || null));
    const msg = doc.createElement('span');
    msg.className = 'msg';
    const bar = doc.createElement('span');
    bar.className = 'bar';
    bar.append(select, fill, saveNew, update, msg);
    shadow.append(style, bar);

    let profiles = [];
    let activeId = null;

    function render() {
      const opts = [new Option(profiles.length ? 'Select profile' : 'No profiles yet', '')];
      for (const p of profiles) opts.push(new Option(p.name, p.id, false, p.id === activeId));
      select.replaceChildren(...opts);
      update.disabled = !select.value;
    }

    function attach() {
      if (host.isConnected) return true;
      const heading = findHeading(doc);
      if (!heading) return false;
      heading.insertAdjacentElement('afterend', host);
      return true;
    }

    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending || host.isConnected) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        attach();
      }, 300);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    attach();

    return {
      attach,
      isAttached: () => host.isConnected,
      setProfiles(list, id) {
        profiles = list;
        activeId = id;
        render();
      },
      setMessage(text, cls) {
        msg.textContent = text || '';
        msg.className = 'msg ' + (cls || '');
      },
    };
  }

  (root.MSA = root.MSA || {}).toolbar = { mount, findHeading };
})(globalThis);

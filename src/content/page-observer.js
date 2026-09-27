/*
 * Runs in the page's MAIN world. Passively observes responses the panel
 * itself already requested and forwards a copy of the ones we understand to
 * the isolated content script.
 *
 * Read only: it never changes, delays, repeats or creates requests.
 */
(function () {
  'use strict';

  if (window.__msaObserverInstalled) return;
  window.__msaObserverInstalled = true;

  const SOURCE = 'msa-page-observer';
  const WATCHED = [{ kind: 'transferPrice', test: /\/api\/cataloging\/singleCatalogUpload\/getTransferPrice(?:[?#]|$)/ }];

  function kindFor(url) {
    const hit = WATCHED.find((w) => w.test.test(String(url)));
    return hit ? hit.kind : null;
  }

  function parse(body) {
    if (body == null) return null;
    if (typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) return body;
    try {
      return JSON.parse(String(body));
    } catch (e) {
      return null;
    }
  }

  function emit(kind, requestBody, responseBody) {
    const response = parse(responseBody);
    if (!response) return;
    window.postMessage({ source: SOURCE, kind, request: parse(requestBody), response }, window.location.origin);
  }

  // XMLHttpRequest (the panel uses axios, which uses XHR in browsers).
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const open = XHR.open;
    const send = XHR.send;
    XHR.open = function (method, url) {
      this.__msaKind = kindFor(url);
      return open.apply(this, arguments);
    };
    XHR.send = function (body) {
      const kind = this.__msaKind;
      if (kind) {
        this.addEventListener('load', () => {
          if (this.status >= 200 && this.status < 300) {
            const res = this.responseType === '' || this.responseType === 'text' ? this.responseText : this.response;
            emit(kind, body, res);
          }
        });
      }
      return send.apply(this, arguments);
    };
  }

  // fetch, in case parts of the panel use it.
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const kind = kindFor(url);
      const p = origFetch.apply(this, arguments);
      if (kind) {
        p.then((res) => {
          if (!res.ok) return;
          res
            .clone()
            .text()
            .then((text) => emit(kind, init && init.body, text))
            .catch(() => {});
        }).catch(() => {});
      }
      return p;
    };
  }
})();

# Seller Listing Assistant

An unofficial Chrome extension (Manifest V3) for Meesho suppliers. It works
inside the Supplier Panel and helps with:

- **Payout and shipping insight.** It reads the price breakdown the panel already
  calculates (shipping, customer price, TCS/TDS, settlement) and adds your
  profit after costs. Every charge is saved to a local log, so you can see the
  real shipping rates per category and weight slab.
- **Shipping calculator.** Before you list, estimate shipping, what the
  customer pays, bank settlement (GST on fees, TCS, TDS) and profit, with a
  price what-if table and the price needed for a target profit. Shipping comes
  from the strongest evidence available: the panel's own figure on this page,
  your logged panel charges for the category and weight, the category's base
  shipping from the panel's form, then your fallback rates. It warns when
  price + shipping is above MRP, as the panel does.
- **Save a form as a profile.** Fill one product by hand, then click
  **Save as profile** in the toolbar next to "Add Product Details". Every
  field is saved, including category attributes like Color, Play Time and
  Size. **Update** merges a later form into the selected profile.
- **Listing autofill.** Pick a profile and click **Auto Fill**. It fills text
  fields, dropdowns (using their search box), multi-select sizes and every
  size row of the price table. It never overwrites values you already typed
  unless you ask it to. You still review and submit every listing yourself.
- **Reusable product profiles.** A base profile holds details shared by all
  your products (manufacturer, packer, GST, country). Product profiles inherit
  from it. Templates like `Wireless Earbuds {{Color}}` are supported. Per
  profile you can mark fields to skip during Auto Fill or keep during Update.
- **Workflow.** A queue for listing many products one after another, a
  pre-submit checklist (required fields, price vs MRP, loss-making prices,
  return-discount limit), a keyboard shortcut (Alt+Shift+F) and profile
  import/export.

Not affiliated with Meesho. All data stays in your browser (`chrome.storage.local`).

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → choose this folder.
3. Open the Supplier Panel. Reload the tab once after installing.
4. Click the extension icon → **Profiles and settings** to create profiles.

## How it works

```
page-observer.js (MAIN world)   reads the panel's own transfer-price responses
        │ window.postMessage (same origin, validated)
        ▼
main.js (isolated content script)
  ├─ scanner.js     finds form controls by label / identifier
  ├─ capture.js     reads the filled form into profile data
  ├─ autofill.js    types profile values (React-safe), picks dropdown options
  ├─ toolbar.js     inline bar next to "Add Product Details"
  ├─ validator.js   pre-submit checklist
  ├─ panel.js       floating panel (closed shadow DOM)
  └─ lib/           pricing, shipping, profiles, storage (shared with options page)
```

- Field matching uses visible labels and form identifiers taken from the
  panel's schema, not generated CSS classes. If the panel changes, add CSS
  selectors under **Settings → Advanced**.
- The extension never calls panel APIs itself, never submits forms and never
  touches image uploads.

See [docs/REFERENCE_ANALYSIS.md](docs/REFERENCE_ANALYSIS.md) for what we learned
from the existing tool, the verified settlement formula, and which features
were deliberately left out.

## Development

```
npm install
npm test          # unit + jsdom tests
npm run check     # manifest references, syntax, content-script load order
```

No build step: files load as plain scripts. Shared modules work in both the
browser (`globalThis.MSA.*`) and Node (`require`).

## Status

- Tested with unit tests, jsdom form fixtures, and in Chromium against a mocked
  panel page that returns the captured transfer-price response.
- **Not yet tested on the live Supplier Panel.** The first live run may need
  label tweaks or selector overrides.

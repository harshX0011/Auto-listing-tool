# Reference analysis: what the existing tool does

This document is the clean-room boundary. It describes **behaviour** observed
in a capture, in our own words. No code, assets, names or text from the
existing extension (or from the supplier panel's bundles) is copied into this
repository. The implementation in `src/` is written from this spec.

The raw capture stays outside the repo (`reference/` is git-ignored). It also
contains the seller's own account data, which must never be committed.

## 1. What the capture is

- A "Loaded Resources Exporter" dump taken from DevTools on the panel's
  *Add single catalog* page, 2026-09-27.
- It holds the panel's own JavaScript bundles, its API responses, analytics
  beacons, fonts and images, plus 31 `blob:` resources.
- **It does not contain the existing extension's source code.** Extension
  content scripts are not page resources, so DevTools does not export them.
  The one script blob (`_blob/70158a62...js`) is the fflate compression library
  used by the page's analytics SDK, not the extension.
- The evidence about the extension is therefore its **side effects**: the
  image blobs it created and the panel API calls they triggered.

To study the extension's code directly, export it from
`chrome://extensions` (Developer mode, "Pack extension", or copy its folder
from the Chrome profile's `Extensions/` directory) into `reference/`.

## 2. How the panel prices a listing (panel behaviour)

Observed from the panel's API responses and bundle call sites:

1. **Image upload.** The front image is uploaded
   (`singleCatalogUpload/uploadSingleCatalogImages`) and gets a hosted URL.
2. **Visual match.** The panel calls `priceRecommendation/fetchDuplicatePid`
   with `{ sscat_id, image_url, is_old_image_match_enabled: true }` and gets
   back `duplicate_pid`, the id of an existing product whose image matches.
   The image-guidelines response also carries image embeddings, which is
   consistent with embedding-based matching.
3. **Transfer price.** The panel calls `singleCatalogUpload/getTransferPrice`
   with `{ sscat_id, price, gst_percentage, gst_type, supplier_id,
   duplicate_pid }`. The response includes `shipping_charges`, so **the
   shipping estimate is tied to the matched product**, and to packaging
   details when the category asks for them.
4. **Form schema.** `singleCatalogUploadDesktop/fetchProductDetailsV3` returns
   the form definition: identifiers, labels, types, whether each field is
   mandatory, allowed values, and limits (for example `meesho_price` between
   2 and 10000, Wrong/Defective Return Discount max 30%).

### Settlement formula (verified)

Captured response for price 999, GST 18%:

| field | value |
| --- | --- |
| shipping_charges | 95 |
| total_price (customer pays) | 1094 |
| tcs | 4.64 |
| tds | 0.93 |
| gst_price (GST on fees) | -0.01 |
| commission | 0 |
| transfer_price (settlement) | 993.44 |

This matches:

- `taxBase = (price + shipping) / (1 + GST%)` = 1094 / 1.18 = 927.12
- `TCS = 0.5% × taxBase` = 4.64, `TDS = 0.1% × taxBase` = 0.93
- `settlement = price − commission − gst_price − TCS − TDS` = 993.44
- `customer pays = price + shipping` (shipping is paid by the customer)

`src/lib/pricing.js` implements this and `test/pricing.test.js` asserts it.

### Form labels (used for field matching)

`Product Name`, `Meesho Price`, `Wrong / Defective Return Discount(₹)`, `MRP`,
`Inventory`, `Net Weight (gms)`, `Style code/ Product ID (optional)`,
`SKU ID (optional)`, `GST`, `HSN Code`, `Brand`, `COUNTRY OF ORIGIN`,
`Manufacturer/Packer/Importer Name, Address, Pincode`, `Net Quantity (N)`,
`Description`, `Model Name`, plus category attributes such as `Color`,
`Warranty Period`, `Product Length (cm)`. These are in `src/lib/fields.js`.

### The panel's own image rules

The panel ships a list of image types it treats as invalid: *Watermark image,
Fake branded/1st copy, Image with price, Pixelated image, Inverted image,
Blur/unclear image, Incomplete image, Stretched/shrunk image, Image with props,
Image with text.*

## 3. What the existing tool did (inferred from side effects)

- One source image: a 1254×1254 PNG, uploaded once.
- **27 JPEG variants** generated in the page as `blob:` images, each a
  different square size between 1254 and 1408 px.
- Variants seen:
  - the original re-encoded with added grain/noise, same size;
  - the original placed on a larger canvas with a solid or gradient border;
  - stickers overlaid in the corners ("FLASH SALE", "BEST ... GUARANTEED",
    "HIGH QUALITY" seals, a delivery-truck icon).
- The pattern (many near-identical variants of one image, one upload, a
  duplicate-match call and a transfer-price call) is consistent with a loop
  that generates a variant, lets the panel re-run its visual match and price
  calculation, and keeps the variant with the **lowest `shipping_charges`**.
  The exporter keeps one response per URL, so the individual iterations are
  not visible, only the final state.

## 4. Decisions for our implementation

| Existing tool behaviour | Our implementation | Why |
| --- | --- | --- |
| Reads shipping and settlement shown by the panel | **Rebuilt**: `page-observer.js` passively reads the panel's own transfer-price responses; nothing extra is sent | Useful and harmless |
| Autofills listing fields | **Rebuilt** independently: label and identifier matching, React-safe input setting, custom dropdowns | Useful and harmless |
| Reusable product data | **Rebuilt**: profiles with inheritance, templates, validation, import/export, queue | Useful and harmless |
| Generates image variants (borders, noise, stickers) and keeps the one with the cheapest shipping estimate | **Not rebuilt** | Its purpose is to make the panel's visual match and shipping estimate misfire. The added stickers and text fall under the panel's own invalid-image list. Real parcels are weighed and measured by the courier, so a mismatch can lead to weight-discrepancy charges, listing blocks or account action. |

Honest shipping levers we support instead: accurate packaging weight and
dimensions, volumetric-weight checks, slab headroom warnings, packaging
comparison, and a local log of the real charges the panel shows per category.

## 5. Legal and safety notes

- Ideas and behaviour are not protected by copyright; code, images and text
  are. Keep studying behaviour, never paste the other tool's code here.
- Check the existing extension's licence or terms. Some forbid reverse
  engineering; observing its side effects in your own browser is lower risk.
- The panel is not a public API. We only read responses the page already
  fetched, never call its endpoints ourselves, and never submit on the
  seller's behalf.
- Do not use the Meesho name or logo as our product's branding. The extension
  is named neutrally and says "Unofficial, not affiliated with Meesho".
- Get a short legal review before selling this commercially.

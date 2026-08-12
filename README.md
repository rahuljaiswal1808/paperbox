# Paperbox

**A complete PDF workspace that runs on your machine.**

Paperbox is a browser-based PDF editor with no backend. You open a file, work on
it, and export it — the bytes never leave the tab. It keeps working with the
network disconnected, and it stores nothing anywhere except your own browser.

```
File  →  Browser  →  Local processing  →  Export
```

There is no server component, no account, no telemetry, and no upload step for
any standard PDF operation.

---

## What it does

**Viewing & navigation** — continuous scrolling viewer with page virtualisation,
fit-width/fit-page zoom, ⌘-scroll zoom, thumbnail sidebar, bookmark outline,
full-text search with match navigation, and fullscreen.

**Editing** — text boxes, editing text that already exists in the file, images,
rectangles, ellipses, lines, arrows, freehand ink, highlight, underline,
strikethrough, sticky notes, and signatures. Everything is a live object you can
move, resize, rotate, restyle, reorder and undo.

**Page management** — insert blank pages, duplicate, delete, drag-and-drop
reordering, rotate, crop, extract a selection to its own file, and insert pages
from another PDF.

**Documents** — merge several PDFs, split by range/selection/every-N/one-per-page,
compress at four quality levels, repair damaged files, edit metadata, and manage
bookmarks that are written into the exported outline.

**Signing & security** — draw, type or upload a signature (saved for reuse in
this browser), place and resize it, encrypt with a user and owner password, set
print/copy/edit permissions, redact content permanently, add watermarks, and add
headers, footers and page numbers.

**Forms** — fill fields that already exist in a PDF, and add new text fields,
checkboxes, dropdowns and radio buttons that stay interactive in the export.

**Conversion** — PDF → PNG/JPG/WebP at 72–600 DPI, PDF → TXT, images → PDF, and
best-effort PDF/A output.

**Working comfortably** — drag-and-drop opening anywhere in the window,
autosave with session recovery, undo/redo with labelled history, keyboard
shortcuts (press `?`), light/dark themes, progress indicators with cancellation,
and errors that say what actually went wrong.

---

## Running it

```bash
npm install     # also vendors pdf.js's runtime assets into public/pdfjs
npm run dev     # http://localhost:5173
npm run build   # production build into dist/
npm run preview # serve the production build
```

`dist/` is a static bundle. Any static host — or a local file server — will do;
there is nothing to deploy behind it.

### Hosting on GitHub Pages

A workflow is already committed at `.github/workflows/deploy.yml`. One manual
step turns it on:

1. Push this branch and merge it into the default branch.
2. Go to **Settings → Pages → Build and deployment** and set **Source** to
   **GitHub Actions**.

That's it — every push to the default branch rebuilds and redeploys, and the
site appears at `https://rahuljaiswal1808.github.io/paperbox/`. You can also trigger it by
hand from the **Actions** tab (*Deploy to GitHub Pages → Run workflow*).

The workflow passes the repository's public path to the build as `PAGES_BASE`,
which becomes Vite's `base`. Every runtime URL — the pdf.js worker, standard
fonts, CMaps, wasm decoders and the service-worker scope — is derived from
`import.meta.env.BASE_URL`, so a project site under `/<repo>/` works with no
other changes. A user/org site (a repo named `<user>.github.io`) serves from the
root and needs nothing at all.

To reproduce a Pages build locally:

```bash
PAGES_BASE=/paperbox npm run build
PAGES_BASE=/paperbox npm run preview   # http://localhost:4173/paperbox/
```

Hosting the app publicly does not expose anyone's documents: the deployed
artefact is just HTML, JS and wasm. Every PDF stays in the visitor's browser,
because there is nowhere else for it to go.

### Other hosts

Any static host works the same way — Netlify, Cloudflare Pages, S3, nginx, or a
folder served by `npx serve dist`. Set `PAGES_BASE` only if the app lives in a
subdirectory. Opening `dist/index.html` straight off disk with `file://` will
*not* work: module workers and the service worker need a real HTTP origin.

### Tests

```bash
npm run smoke   # builds, generates a fixture PDF, runs the browser suites
```

Three Playwright suites drive the real application in a real browser:

| Suite | What it proves |
| --- | --- |
| `scripts/smoke.mjs` | Open, render, search, annotate, undo/redo, page ops, export, redaction, encryption |
| `scripts/smoke-tools.mjs` | Images→PDF, merge, split, compress, PDF→images, PDF→text, watermark, headers, signature, crop, form fields, repair, opening an encrypted file |
| `scripts/smoke-offline.mjs` | Service-worker precaching, then opening and rendering a PDF with the network off |

The assertions check outcomes, not just clicks: exported files are re-parsed with
pdf-lib and re-read with pdf.js. Redaction, for instance, is verified by
extracting the text of the exported page and asserting the redacted string is
*gone* — not merely covered.

---

## How it is built

```
src/
  types/document.ts        The edit model: pages, objects, sources, assets
  lib/
    pdf/
      pdfjs.ts             pdf.js setup, document cache, page rendering
      geometry.ts          display-space ⇄ PDF-space maths (rotation, crop)
      text.ts              text extraction, search, hit-testing
      raster.ts            canvas composition (thumbnails, flattening, export)
      export.ts            the writer: model → PDF bytes (DOM-free)
      fonts.ts             standard-font mapping and WinAnsi folding
      textLayout.ts        word wrap shared by the canvas and the writer
    ops/                   documents, pages, decoration, conversion, repair, OCR hook
    worker/                the PDF worker and its RPC client
    storage/db.ts          IndexedDB: sessions, recents, signatures, prefs
  state/                   zustand stores (editor + history, UI, search, security)
  components/              app shell, viewer, sidebar, panels, dialogs
  app/                     commands, hooks, service-worker registration
```

### The edit model

A document is not a PDF — it is a description of how to build one: a list of
pages that point back at source PDF bytes, plus the objects layered on top of
them. Nothing is flattened until export, so every operation stays reversible and
the original bytes are never modified in place. Undo/redo takes shallow snapshots
of that model, so pages and multi-megabyte source buffers are shared between
history entries rather than copied.

Object geometry is stored in **display space**: PDF points, origin at the
top-left of the page as it is currently shown, y downward. Rotating a page
rewrites its objects' coordinates, which keeps the view layer a plain multiply by
zoom, and `geometry.ts` maps everything back to PDF user space at export time.
The mappings match pdf.js's own viewport transform, so what you see is what gets
written.

### Where the work happens

| Job | Runs on |
| --- | --- |
| Parsing and rendering pages | pdf.js's own Web Worker |
| Assembling and writing PDFs | `pdfops.worker.ts` (a second Web Worker) |
| Rasterising pages (redaction, image compression, image export) | Main thread — it needs a canvas — with progress and cancellation |
| Everything else | Main thread |

The export path picks its lane automatically: jobs that need a canvas run on the
main thread, everything else goes to the worker, and both report progress the
same way.

### Offline

`vite-plugin-pwa` precaches the app shell **and** pdf.js's runtime assets — the
worker, standard fonts, CMaps and the JBIG2/JPEG2000 wasm decoders — which are
vendored into `public/pdfjs` at install time. pdf.js is loaded from its *legacy*
build, which is transpiled and polyfilled so rendering works on browsers a
release or two behind the newest.

---

## Deliberate limits

These are design decisions, and the UI says so where it matters:

- **Editing existing text** places an opaque box over the original line and lets
  you retype it; it does not reflow the source paragraph. Reflowing text inside
  an arbitrary content stream is not something any browser-side library does
  reliably. The original characters remain in the file underneath — use
  **Redact** when they must actually be removed.
- **New text** uses the 14 standard PDF fonts. Characters outside WinAnsi are
  folded (curly quotes, dashes, ellipses) or substituted, and the export warns
  when that happens.
- **Redaction is destructive on export.** Pages carrying a redaction are rebuilt
  from rendered pixels, so the removed content cannot be recovered from the file
  — and the page's text is no longer selectable. That trade is the point.
- **Permission flags** (print/copy/edit) are honoured by well-behaved readers but
  are not a security boundary. Only the open password actually encrypts.
- **PDF/A** output rasterises pages and embeds an sRGB output intent. That
  sidesteps the font-embedding rules but is not a substitute for validating with
  veraPDF.
- **OCR is an extension point, not a bundled feature** (see below).

## Extending it

The architecture leaves room for the features that were scoped out:

- **OCR** — `src/lib/ops/ocr.ts` defines the engine contract. Register one before
  the app mounts (`window.paperboxRegisterOcrEngine({ ... })`) and the OCR dialog
  lights up. The result shape is word-level so an engine can write a real
  invisible text layer behind a scan rather than dumping a text blob. English
  first; the contract is already multilingual.
- **Office conversion** — `lib/ops/convert.ts` is where a DOCX/XLSX/PPTX path
  would land; the model already separates "read a source" from "build a
  document".
- **Batch processing and CLI automation** — every operation is a pure function
  over the model plus `buildPdf`, none of which touches React. The same modules
  can be driven from a queue or from Node.
- **AI features** — the text extraction layer (`lib/pdf/text.ts`) already yields
  per-item positions, which is the input such features need.

## Licence and credits

Built with [React](https://react.dev), [Vite](https://vite.dev),
[pdf.js](https://mozilla.github.io/pdf.js/),
[@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib),
[zustand](https://zustand.docs.pmnd.rs), [idb](https://github.com/jakearchibald/idb),
[dnd-kit](https://dndkit.com) and [fflate](https://github.com/101arrowz/fflate).

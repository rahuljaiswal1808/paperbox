/**
 * Turns an `EditorDocument` back into PDF bytes.
 *
 * This module is deliberately DOM-free: anything that needs a canvas (page
 * rasterisation for redaction or aggressive compression) is injected by the
 * caller as a `PageRasterizer`. That keeps the writer usable from a worker and
 * makes the rules about *what* gets flattened explicit.
 */
import {
  degrees,
  LineCapStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  rgb,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type {
  Bookmark,
  EditorDocument,
  FormFieldObject,
  ImageObject,
  InkObject,
  MarkupObject,
  NoteObject,
  PageObject,
  PageState,
  Rect,
  ShapeObject,
  TextObject,
} from '../../types/document';
import { parseColor } from '../util/color';
import { displayToPdf, placePoint, placeRect, unrotatedSize } from './geometry';
import { sanitizeForStandardFont, standardFontFor } from './fonts';
import { layoutText } from './textLayout';

export interface SecuritySettings {
  userPassword?: string;
  ownerPassword?: string;
  permissions: {
    printing: boolean;
    highQualityPrinting: boolean;
    modifying: boolean;
    copying: boolean;
    annotating: boolean;
    fillingForms: boolean;
    contentAccessibility: boolean;
    documentAssembly: boolean;
  };
}

export interface RasterizedPage {
  bytes: Uint8Array;
  type: 'image/jpeg' | 'image/png';
  /** Pixel size; the page keeps its point size regardless. */
  width: number;
  height: number;
}

export type PageRasterizer = (
  page: PageState,
  index: number,
  options: { dpi: number; quality: number; format: 'jpeg' | 'png' },
) => Promise<RasterizedPage>;

export interface BuildOptions {
  /** Rasterise every page (used by the stronger compression levels). */
  rasterizeAll?: boolean;
  rasterDpi?: number;
  rasterQuality?: number;
  rasterFormat?: 'jpeg' | 'png';
  rasterize?: PageRasterizer;
  security?: SecuritySettings | null;
  /** Tag the output as PDF/A. Only meaningful when every page is rasterised or
   *  all fonts are embedded — see the note in the export dialog. */
  pdfa?: '1B' | '2B' | '3B' | null;
  /** Write the document metadata from the model. Defaults to true. */
  applyMetadata?: boolean;
  /** Emit cross-reference and object streams. Smaller, PDF 1.5+. */
  useObjectStreams?: boolean;
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
}

export interface BuildResult {
  bytes: Uint8Array;
  warnings: string[];
}

const toRgb = (color: string) => {
  const { r, g, b } = parseColor(color);
  return rgb(r, g, b);
};

const alphaOf = (color: string, fallback = 1) => {
  const { a } = parseColor(color);
  return Number.isFinite(a) ? a * fallback : fallback;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
};

/** Pages needing destructive flattening: redactions can never survive as vectors. */
export const pageNeedsFlattening = (page: PageState): boolean =>
  page.flatten === true || page.objects.some((o) => o.kind === 'redact');

export async function buildPdf(
  doc: EditorDocument,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const {
    rasterizeAll = false,
    rasterDpi = 150,
    rasterQuality = 0.8,
    rasterFormat = 'jpeg',
    rasterize,
    security = null,
    pdfa = null,
    applyMetadata = true,
    useObjectStreams = true,
    onProgress,
    signal,
  } = options;

  const warnings: string[] = [];
  const out = await PDFDocument.create();
  const fontCache = new Map<string, PDFFont>();
  const imageCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();

  const getFont = async (obj: TextObject): Promise<PDFFont> => {
    const name = standardFontFor(obj.style.font, obj.style.bold, obj.style.italic);
    const cached = fontCache.get(name);
    if (cached) return cached;
    const font = await out.embedFont(name);
    fontCache.set(name, font);
    return font;
  };

  const embedImage = async (assetId: string) => {
    const cached = imageCache.get(assetId);
    if (cached) return cached;
    const asset = doc.assets[assetId];
    if (!asset) throw new Error(`Missing image asset ${assetId}`);
    const embedded =
      asset.type === 'image/jpeg'
        ? await out.embedJpg(asset.bytes)
        : await out.embedPng(asset.bytes);
    imageCache.set(assetId, embedded);
    return embedded;
  };

  onProgress?.(0.02, 'Reading source files');

  // ---------------------------------------------------------------- sources
  const sourceDocs = new Map<string, PDFDocument>();
  const loadSource = async (sourceId: string): Promise<PDFDocument> => {
    const cached = sourceDocs.get(sourceId);
    if (cached) return cached;
    const source = doc.sources[sourceId];
    if (!source) throw new Error(`Missing source ${sourceId}`);
    const loaded = await PDFDocument.load(source.bytes, {
      ignoreEncryption: true,
      password: source.password,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    // Fill any of the source's own form fields the user edited, then flatten so
    // the values survive `copyPages` (widget annotations do not).
    const fills = doc.pages
      .filter((p) => p.sourceId === sourceId)
      .flatMap((p) => p.objects)
      .filter((o): o is FormFieldObject => o.kind === 'field' && Boolean(o.sourceField));
    if (fills.length > 0) {
      try {
        const form = loaded.getForm();
        for (const fill of fills) {
          const field = form.getFields().find((f) => f.getName() === fill.name);
          if (!field) continue;
          const type = field.constructor.name;
          if (type === 'PDFTextField') form.getTextField(fill.name).setText(fill.value);
          else if (type === 'PDFCheckBox') {
            const box = form.getCheckBox(fill.name);
            if (fill.checked) box.check();
            else box.uncheck();
          } else if (type === 'PDFDropdown') form.getDropdown(fill.name).select(fill.value);
          else if (type === 'PDFRadioGroup') form.getRadioGroup(fill.name).select(fill.value);
        }
        form.flatten();
      } catch (error) {
        warnings.push(
          `Could not write form values into "${source.name}": ${(error as Error).message}`,
        );
      }
    }
    sourceDocs.set(sourceId, loaded);
    return loaded;
  };

  // ------------------------------------------------------------ copy pages
  const flattenFlags = doc.pages.map((page) => rasterizeAll || pageNeedsFlattening(page));
  const copies = new Map<number, PDFPage>();
  const bySource = new Map<string, { modelIndex: number; sourceIndex: number }[]>();

  doc.pages.forEach((page, index) => {
    if (!page.sourceId || flattenFlags[index]) return;
    const list = bySource.get(page.sourceId) ?? [];
    list.push({ modelIndex: index, sourceIndex: page.sourceIndex });
    bySource.set(page.sourceId, list);
  });

  for (const [sourceId, entries] of bySource) {
    throwIfAborted(signal);
    const src = await loadSource(sourceId);
    const max = src.getPageCount();
    const valid = entries.filter((e) => e.sourceIndex < max);
    if (valid.length !== entries.length) {
      warnings.push(`Some pages were missing from "${doc.sources[sourceId]?.name}" and were skipped.`);
    }
    const copied = await out.copyPages(
      src,
      valid.map((e) => e.sourceIndex),
    );
    valid.forEach((entry, i) => copies.set(entry.modelIndex, copied[i]));
  }

  onProgress?.(0.2, 'Assembling pages');

  // ------------------------------------------------------------ build pages
  const outPages: PDFPage[] = [];
  for (let index = 0; index < doc.pages.length; index += 1) {
    throwIfAborted(signal);
    const page = doc.pages[index];
    const { width: mediaWidth, height: mediaHeight } = unrotatedSize(page);
    let pdfPage: PDFPage;

    if (flattenFlags[index]) {
      if (!rasterize) throw new Error('This export needs page rasterisation, which is unavailable here.');
      const raster = await rasterize(page, index, {
        dpi: rasterDpi,
        quality: rasterQuality,
        format: rasterFormat,
      });
      const image =
        raster.type === 'image/jpeg'
          ? await out.embedJpg(raster.bytes)
          : await out.embedPng(raster.bytes);
      // The rasteriser renders the page as displayed, so the new page has the
      // display size and no rotation.
      const crop = page.crop;
      const w = crop?.width ?? page.width;
      const h = crop?.height ?? page.height;
      pdfPage = out.addPage([w, h]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: w, height: h });
      outPages.push(pdfPage);
      onProgress?.(0.2 + (0.6 * (index + 1)) / doc.pages.length, `Rendering page ${index + 1}`);
      continue;
    }

    const copied = copies.get(index);
    if (copied) {
      pdfPage = out.addPage(copied);
    } else {
      pdfPage = out.addPage([mediaWidth, mediaHeight]);
    }

    pdfPage.setRotation(degrees(page.rotation));

    if (page.crop) {
      const a = displayToPdf(page, { x: page.crop.x, y: page.crop.y });
      const b = displayToPdf(page, {
        x: page.crop.x + page.crop.width,
        y: page.crop.y + page.crop.height,
      });
      const box = pdfPage.getMediaBox();
      const x = Math.min(a.x, b.x) + box.x;
      const y = Math.min(a.y, b.y) + box.y;
      pdfPage.setCropBox(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }

    for (const object of page.objects) {
      await drawObject(out, pdfPage, page, object, { getFont, embedImage, warnings });
    }

    outPages.push(pdfPage);
    onProgress?.(0.2 + (0.6 * (index + 1)) / doc.pages.length, `Writing page ${index + 1}`);
  }

  // ------------------------------------------------------------- extras
  if (applyMetadata) applyDocumentMetadata(out, doc);
  if (doc.bookmarks.length > 0) writeOutline(out, doc.bookmarks, outPages, warnings);

  if (pdfa) {
    try {
      out.convertToPDFA({ conformance: pdfa });
    } catch (error) {
      warnings.push(`PDF/A metadata could not be applied: ${(error as Error).message}`);
    }
  }

  if (security && (security.userPassword || security.ownerPassword)) {
    if (pdfa) warnings.push('PDF/A forbids encryption — the password was still applied, so the file is not conformant.');
    out.encrypt({
      userPassword: security.userPassword || undefined,
      ownerPassword: security.ownerPassword || security.userPassword || undefined,
      permissions: {
        printing: security.permissions.printing
          ? security.permissions.highQualityPrinting
            ? 'highResolution'
            : 'lowResolution'
          : undefined,
        modifying: security.permissions.modifying,
        copying: security.permissions.copying,
        annotating: security.permissions.annotating,
        fillingForms: security.permissions.fillingForms,
        contentAccessibility: security.permissions.contentAccessibility,
        documentAssembly: security.permissions.documentAssembly,
      },
    });
  }

  onProgress?.(0.9, 'Saving');
  const bytes = await out.save({ useObjectStreams, updateFieldAppearances: true });
  onProgress?.(1, 'Done');
  return { bytes, warnings };
}

// --------------------------------------------------------------------------
// object drawing
// --------------------------------------------------------------------------

interface DrawContext {
  getFont: (obj: TextObject) => Promise<PDFFont>;
  embedImage: (assetId: string) => Promise<Awaited<ReturnType<PDFDocument['embedPng']>>>;
  warnings: string[];
}

async function drawObject(
  out: PDFDocument,
  pdfPage: PDFPage,
  page: PageState,
  object: PageObject,
  ctx: DrawContext,
): Promise<void> {
  switch (object.kind) {
    case 'text':
      return drawTextObject(pdfPage, page, object, ctx);
    case 'image':
      return drawImageObject(pdfPage, page, object, ctx);
    case 'shape':
      return drawShapeObject(pdfPage, page, object);
    case 'ink':
      return drawInkObject(pdfPage, page, object);
    case 'markup':
      return drawMarkupObject(pdfPage, page, object);
    case 'note':
      return drawNoteObject(pdfPage, page, object, ctx);
    case 'field':
      return drawFieldObject(out, pdfPage, page, object, ctx);
    case 'redact':
      // Redactions are handled by flattening the page; nothing vector to draw.
      return undefined;
    default:
      return undefined;
  }
}

async function drawTextObject(
  pdfPage: PDFPage,
  page: PageState,
  object: TextObject,
  ctx: DrawContext,
): Promise<void> {
  const font = await ctx.getFont(object);
  const clean = sanitizeForStandardFont(object.text);
  if (clean.dropped.length > 0) {
    ctx.warnings.push(
      `Characters not supported by the built-in fonts were replaced: ${clean.dropped.slice(0, 6).join(' ')}`,
    );
  }

  const centre = { x: object.x + object.width / 2, y: object.y + object.height / 2 };

  if (object.background) {
    const placement = placeRect(page, object, object.rotation);
    pdfPage.drawRectangle({
      x: placement.x,
      y: placement.y,
      width: object.width,
      height: object.height,
      rotate: degrees(placement.rotate),
      color: toRgb(object.background),
      opacity: alphaOf(object.background),
    });
  }

  const lines = layoutText(
    clean.text,
    object.style,
    object.width,
    (text, size) => font.widthOfTextAtSize(text, size),
    object.baselineOffset,
  );

  for (const line of lines) {
    if (!line.text) continue;
    if (line.baseline > object.height + object.style.size) break; // overflow is clipped
    const start = placePoint(
      page,
      { x: object.x + line.x, y: object.y + line.baseline },
      object.rotation,
      centre,
    );
    pdfPage.drawText(line.text, {
      x: start.x,
      y: start.y,
      size: object.style.size,
      font,
      color: toRgb(object.style.color),
      opacity: object.opacity ?? 1,
      rotate: degrees(start.rotate),
    });
  }
}

async function drawImageObject(
  pdfPage: PDFPage,
  page: PageState,
  object: ImageObject,
  ctx: DrawContext,
): Promise<void> {
  const image = await ctx.embedImage(object.assetId);
  const placement = placeRect(page, object, object.rotation);
  pdfPage.drawImage(image, {
    x: placement.x,
    y: placement.y,
    width: object.width,
    height: object.height,
    rotate: degrees(placement.rotate),
    opacity: object.opacity ?? 1,
  });
}

function drawShapeObject(pdfPage: PDFPage, page: PageState, object: ShapeObject): void {
  const opacity = object.opacity ?? 1;
  const centre = { x: object.x + object.width / 2, y: object.y + object.height / 2 };

  if (object.shape === 'line' || object.shape === 'arrow') {
    const from = object.from ?? { x: 0, y: 0.5 };
    const to = object.to ?? { x: 1, y: 0.5 };
    const p1 = { x: object.x + from.x * object.width, y: object.y + from.y * object.height };
    const p2 = { x: object.x + to.x * object.width, y: object.y + to.y * object.height };
    const a = placePoint(page, p1, object.rotation, centre);
    const b = placePoint(page, p2, object.rotation, centre);
    pdfPage.drawLine({
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      thickness: object.strokeWidth,
      color: toRgb(object.stroke),
      opacity,
      lineCap: LineCapStyle.Round,
    });
    if (object.shape === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const size = Math.max(6, object.strokeWidth * 3.5);
      for (const spread of [Math.PI * 0.82, -Math.PI * 0.82]) {
        pdfPage.drawLine({
          start: { x: b.x, y: b.y },
          end: {
            x: b.x + Math.cos(angle + spread) * size,
            y: b.y + Math.sin(angle + spread) * size,
          },
          thickness: object.strokeWidth,
          color: toRgb(object.stroke),
          opacity,
          lineCap: LineCapStyle.Round,
        });
      }
    }
    return;
  }

  const placement = placeRect(page, object, object.rotation);
  if (object.shape === 'rectangle') {
    pdfPage.drawRectangle({
      x: placement.x,
      y: placement.y,
      width: object.width,
      height: object.height,
      rotate: degrees(placement.rotate),
      borderWidth: object.strokeWidth,
      borderColor: toRgb(object.stroke),
      borderOpacity: opacity,
      color: object.fill ? toRgb(object.fill) : undefined,
      opacity: object.fill ? alphaOf(object.fill, opacity) : undefined,
    });
    return;
  }

  const c = displayToPdf(page, centre);
  pdfPage.drawEllipse({
    x: c.x,
    y: c.y,
    xScale: object.width / 2,
    yScale: object.height / 2,
    rotate: degrees(page.rotation - object.rotation),
    borderWidth: object.strokeWidth,
    borderColor: toRgb(object.stroke),
    borderOpacity: opacity,
    color: object.fill ? toRgb(object.fill) : undefined,
    opacity: object.fill ? alphaOf(object.fill, opacity) : undefined,
  });
}

function drawInkObject(pdfPage: PDFPage, page: PageState, object: InkObject): void {
  const colour = toRgb(object.stroke);
  const opacity = object.opacity ?? 1;
  const centre = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
  for (const stroke of object.strokes) {
    if (stroke.length === 1) {
      const only = placePoint(page, stroke[0], object.rotation, centre);
      pdfPage.drawCircle({
        x: only.x,
        y: only.y,
        size: object.strokeWidth / 2,
        color: colour,
        opacity,
      });
      continue;
    }
    for (let i = 1; i < stroke.length; i += 1) {
      const a = placePoint(page, stroke[i - 1], object.rotation, centre);
      const b = placePoint(page, stroke[i], object.rotation, centre);
      pdfPage.drawLine({
        start: { x: a.x, y: a.y },
        end: { x: b.x, y: b.y },
        thickness: object.strokeWidth,
        color: colour,
        opacity,
        lineCap: LineCapStyle.Round,
      });
    }
  }
}

function drawMarkupObject(pdfPage: PDFPage, page: PageState, object: MarkupObject): void {
  for (const rect of object.rects) {
    if (object.markup === 'highlight') {
      const placement = placeRect(page, rect, 0);
      pdfPage.drawRectangle({
        x: placement.x,
        y: placement.y,
        width: rect.width,
        height: rect.height,
        rotate: degrees(placement.rotate),
        color: toRgb(object.color),
        opacity: 0.35,
      });
      continue;
    }
    const y = object.markup === 'underline' ? rect.y + rect.height * 0.94 : rect.y + rect.height * 0.55;
    const a = placePoint(page, { x: rect.x, y });
    const b = placePoint(page, { x: rect.x + rect.width, y });
    pdfPage.drawLine({
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      thickness: Math.max(0.8, rect.height * 0.06),
      color: toRgb(object.color),
      opacity: 0.9,
    });
  }
}

async function drawNoteObject(
  pdfPage: PDFPage,
  page: PageState,
  object: NoteObject,
  ctx: DrawContext,
): Promise<void> {
  // A sticky note exports as a small labelled marker plus a real PDF text
  // annotation, so other readers show the note content too.
  const placement = placeRect(page, object, 0);
  pdfPage.drawRectangle({
    x: placement.x,
    y: placement.y,
    width: object.width,
    height: object.height,
    rotate: degrees(placement.rotate),
    color: toRgb(object.color),
    opacity: 0.95,
    borderColor: rgb(0, 0, 0),
    borderOpacity: 0.25,
    borderWidth: 0.5,
  });

  const context = pdfPage.doc.context;
  const annotation = context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Name: 'Comment',
    Rect: [placement.x, placement.y, placement.x + object.width, placement.y + object.height],
    Contents: PDFHexString.fromText(sanitizeForStandardFont(object.text).text),
    T: PDFHexString.fromText(object.author ?? 'Note'),
    C: [1, 0.85, 0.3],
  });
  const ref = context.register(annotation);
  const annots = pdfPage.node.lookup(PDFName.of('Annots'), PDFArray);
  if (annots) annots.push(ref);
  else pdfPage.node.set(PDFName.of('Annots'), context.obj([ref]));
  void ctx;
}

async function drawFieldObject(
  out: PDFDocument,
  pdfPage: PDFPage,
  page: PageState,
  object: FormFieldObject,
  ctx: DrawContext,
): Promise<void> {
  if (object.sourceField) return; // already written into the source document
  const placement = placeRect(page, object, 0);
  const form = out.getForm();
  const appearance = {
    x: placement.x,
    y: placement.y,
    width: object.width,
    height: object.height,
    borderWidth: 1,
    borderColor: rgb(0.45, 0.5, 0.6),
    backgroundColor: rgb(0.96, 0.97, 1),
  };

  try {
    if (object.field === 'checkbox') {
      const box = form.createCheckBox(object.name);
      box.addToPage(pdfPage, appearance);
      if (object.checked) box.check();
      return;
    }
    if (object.field === 'dropdown') {
      const dropdown = form.createDropdown(object.name);
      dropdown.setOptions((object.options ?? []).map((o) => sanitizeForStandardFont(o).text));
      if (object.value) dropdown.select(sanitizeForStandardFont(object.value).text);
      dropdown.addToPage(pdfPage, appearance);
      return;
    }
    if (object.field === 'radio') {
      const group = form.createRadioGroup(object.name);
      group.addOptionToPage(sanitizeForStandardFont(object.value || 'Option').text, pdfPage, appearance);
      return;
    }
    const field = form.createTextField(object.name);
    field.setText(sanitizeForStandardFont(object.value).text);
    if (object.fontSize) field.setFontSize(object.fontSize);
    if (object.required) field.enableRequired();
    field.addToPage(pdfPage, appearance);
  } catch (error) {
    ctx.warnings.push(`Form field "${object.name}" could not be created: ${(error as Error).message}`);
  }
}

// --------------------------------------------------------------------------
// metadata + outline
// --------------------------------------------------------------------------

export function applyDocumentMetadata(out: PDFDocument, doc: EditorDocument): void {
  const meta = doc.metadata;
  out.setTitle(meta.title || '', { showInWindowTitleBar: true });
  out.setAuthor(meta.author || '');
  out.setSubject(meta.subject || '');
  out.setKeywords(
    meta.keywords
      ? meta.keywords.split(/[,;]/).map((k) => k.trim()).filter(Boolean)
      : [],
  );
  out.setCreator(meta.creator || 'Paperbox');
  out.setProducer(meta.producer || 'Paperbox (local, offline)');
  out.setCreationDate(new Date(meta.creationDate ?? doc.createdAt));
  out.setModificationDate(new Date());
}

/** Write a /Outlines tree. pdf-lib has no outline API, so build the dicts by hand. */
function writeOutline(
  out: PDFDocument,
  bookmarks: Bookmark[],
  pages: PDFPage[],
  warnings: string[],
): void {
  if (pages.length === 0) return;
  try {
    const context = out.context;
    const rootRef = context.nextRef();

    const build = (items: Bookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } | null => {
      const refs = items.map(() => context.nextRef());
      if (refs.length === 0) return null;
      let total = 0;

      items.forEach((item, i) => {
        const pageIndex = Math.max(0, Math.min(pages.length - 1, item.pageIndex));
        const children = build(item.children, refs[i]);
        const entries: Record<string, PDFRef | PDFHexString | PDFNumber | unknown[]> = {
          Title: PDFHexString.fromText(item.title || 'Untitled'),
          Parent: parent,
          Dest: [pages[pageIndex].ref, PDFName.of('Fit')],
        };
        if (i > 0) entries.Prev = refs[i - 1];
        if (i < refs.length - 1) entries.Next = refs[i + 1];
        if (children) {
          entries.First = children.first;
          entries.Last = children.last;
          entries.Count = PDFNumber.of(children.count);
        }
        const obj = context.obj(entries as never) as unknown as PDFDict;
        context.assign(refs[i], obj);
        total += 1 + (children?.count ?? 0);
      });

      return { first: refs[0], last: refs[refs.length - 1], count: total };
    };

    const tree = build(bookmarks, rootRef);
    if (!tree) return;
    context.assign(
      rootRef,
      context.obj({
        Type: 'Outlines',
        First: tree.first,
        Last: tree.last,
        Count: PDFNumber.of(tree.count),
      }) as unknown as PDFDict,
    );
    out.catalog.set(PDFName.of('Outlines'), rootRef);
    out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  } catch (error) {
    warnings.push(`Bookmarks could not be written: ${(error as Error).message}`);
  }
}

/** Rects (display space) of everything that must be destroyed on a page. */
export const redactionRects = (page: PageState): Rect[] =>
  page.objects.filter((o) => o.kind === 'redact').map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height }));

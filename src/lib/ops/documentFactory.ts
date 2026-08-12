/**
 * Building `EditorDocument`s from files on the user's machine.
 *
 * Files are read with `FileReader`/`arrayBuffer()` and never leave the tab.
 */
import type {
  Bookmark,
  DocumentMetadata,
  EditorDocument,
  PageState,
  PdfSource,
  Rotation,
} from '../../types/document';
import { openPdf, openPdfDetached, type PDFDocumentProxy } from '../pdf/pdfjs';
import { normalizeRotation } from '../pdf/geometry';
import { createImageAsset } from './assets';
import { stripExtension, uid } from '../util/misc';
import { readFileBytes } from '../util/file';

export const A4 = { width: 595.28, height: 841.89 };
export const LETTER = { width: 612, height: 792 };

export const emptyMetadata = (): DocumentMetadata => ({
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: 'Paperbox',
  producer: 'Paperbox (local, offline)',
});

export function blankDocument(name = 'Untitled'): EditorDocument {
  const now = Date.now();
  return {
    id: uid('doc'),
    name,
    sources: {},
    assets: {},
    pages: [],
    metadata: emptyMetadata(),
    bookmarks: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function blankPage(width = A4.width, height = A4.height): PageState {
  return {
    id: uid('pg'),
    sourceId: null,
    sourceIndex: -1,
    rotation: 0,
    width,
    height,
    objects: [],
  };
}

/** Read page geometry for every page of an already-open pdf.js document. */
export async function readPageStates(
  pdf: PDFDocumentProxy,
  sourceId: string,
): Promise<PageState[]> {
  const pages: PageState[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      id: uid('pg'),
      sourceId,
      sourceIndex: i - 1,
      rotation: normalizeRotation(page.rotate) as Rotation,
      width: viewport.width,
      height: viewport.height,
      objects: [],
    });
  }
  return pages;
}

async function readMetadata(pdf: PDFDocumentProxy): Promise<DocumentMetadata> {
  const base = emptyMetadata();
  try {
    const { info } = (await pdf.getMetadata()) as unknown as {
      info?: Record<string, unknown>;
    };
    if (!info) return base;
    const str = (key: string) => (typeof info[key] === 'string' ? (info[key] as string) : '');
    const parseDate = (value: string): number | undefined => {
      // PDF dates look like D:20240131120000+01'00'
      const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
      if (!m) return undefined;
      const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
      const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
      return Number.isFinite(ms) ? ms : undefined;
    };
    return {
      title: str('Title'),
      author: str('Author'),
      subject: str('Subject'),
      keywords: str('Keywords'),
      creator: str('Creator') || base.creator,
      producer: str('Producer') || base.producer,
      creationDate: parseDate(str('CreationDate')),
      modificationDate: parseDate(str('ModDate')),
    };
  } catch {
    return base;
  }
}

interface RawOutline {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutline[];
}

async function readBookmarks(pdf: PDFDocumentProxy, pageOffset = 0): Promise<Bookmark[]> {
  try {
    const outline = (await pdf.getOutline()) as RawOutline[] | null;
    if (!outline) return [];

    const resolve = async (item: RawOutline): Promise<Bookmark | null> => {
      let pageIndex = 0;
      try {
        const dest =
          typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (ref && typeof ref === 'object') {
          pageIndex = await pdf.getPageIndex(ref as never);
        }
      } catch {
        pageIndex = 0;
      }
      const children = (await Promise.all((item.items ?? []).map(resolve))).filter(
        (b): b is Bookmark => b !== null,
      );
      return {
        id: uid('bm'),
        title: item.title || 'Untitled',
        pageIndex: pageIndex + pageOffset,
        children,
      };
    };

    return (await Promise.all(outline.map(resolve))).filter((b): b is Bookmark => b !== null);
  } catch {
    return [];
  }
}

export interface OpenedPdf {
  source: PdfSource;
  pages: PageState[];
  metadata: DocumentMetadata;
  bookmarks: Bookmark[];
  numPages: number;
}

/** Open a PDF file into the pieces a document is assembled from. */
export async function readPdfFile(file: File, password?: string): Promise<OpenedPdf> {
  const bytes = await readFileBytes(file);
  const sourceId = uid('src');
  const pdf = await openPdf(sourceId, bytes, password);
  const [pages, metadata, bookmarks] = await Promise.all([
    readPageStates(pdf, sourceId),
    readMetadata(pdf),
    readBookmarks(pdf),
  ]);
  return {
    source: { id: sourceId, name: file.name, bytes, password },
    pages,
    metadata,
    bookmarks,
    numPages: pdf.numPages,
  };
}

/**
 * Assemble one document from PDFs that have already been opened (and, if they
 * were encrypted, unlocked). Pages are concatenated in order and each file's
 * bookmarks are shifted to their new page positions.
 */
export function documentFromOpenedPdfs(opened: OpenedPdf[], name: string): EditorDocument {
  const doc = blankDocument(name);
  for (const entry of opened) {
    doc.sources[entry.source.id] = entry.source;
    const offset = doc.pages.length;
    doc.pages.push(...entry.pages);
    doc.bookmarks.push(...entry.bookmarks.map((b) => shiftBookmark(b, offset)));
  }
  if (opened[0]) doc.metadata = { ...opened[0].metadata };
  doc.metadata.title ||= name;
  return doc;
}

const shiftBookmark = (bookmark: Bookmark, offset: number): Bookmark => ({
  ...bookmark,
  pageIndex: bookmark.pageIndex + offset,
  children: bookmark.children.map((c) => shiftBookmark(c, offset)),
});

export interface ImagesToPdfOptions {
  pageSize: 'fit' | 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
}

/** Build a document whose pages are the given images. */
export async function documentFromImages(
  files: File[],
  options: ImagesToPdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<EditorDocument> {
  const doc = blankDocument(files.length === 1 ? stripExtension(files[0].name) : 'Images');

  for (let i = 0; i < files.length; i += 1) {
    const asset = await createImageAsset(files[i]);
    doc.assets[asset.id] = asset;

    const ratio = asset.width / asset.height;
    let pageWidth: number;
    let pageHeight: number;

    if (options.pageSize === 'fit') {
      // 96 CSS px per inch -> 72 points per inch
      pageWidth = (asset.width * 72) / 96;
      pageHeight = (asset.height * 72) / 96;
    } else {
      const base = options.pageSize === 'letter' ? LETTER : A4;
      const landscape =
        options.orientation === 'landscape' || (options.orientation === 'auto' && ratio > 1);
      pageWidth = landscape ? base.height : base.width;
      pageHeight = landscape ? base.width : base.height;
    }

    const page = blankPage(pageWidth, pageHeight);
    const margin = options.pageSize === 'fit' ? 0 : options.margin;
    const availableW = pageWidth - margin * 2;
    const availableH = pageHeight - margin * 2;
    const scale = Math.min(availableW / asset.width, availableH / asset.height);
    const w = asset.width * scale;
    const h = asset.height * scale;

    page.objects.push({
      id: uid('img'),
      kind: 'image',
      assetId: asset.id,
      x: (pageWidth - w) / 2,
      y: (pageHeight - h) / 2,
      width: w,
      height: h,
      rotation: 0,
    });
    doc.pages.push(page);
    onProgress?.(i + 1, files.length);
  }

  doc.metadata.title = doc.name;
  return doc;
}

/** Page geometry of a PDF the user is importing pages from. */
export async function inspectPdf(bytes: Uint8Array, password?: string) {
  const { doc, close } = await openPdfDetached(bytes, password);
  const sourceId = uid('src');
  const pages = await readPageStates(doc, sourceId);
  await close();
  return { sourceId, pages, bytes };
}

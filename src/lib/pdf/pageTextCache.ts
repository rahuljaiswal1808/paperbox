import type { EditorDocument, PageState } from '../../types/document';
import { openPdf } from './pdfjs';
import { extractPageText, type PageText } from './text';

const EMPTY: PageText = { items: [], text: '', map: [] };
const cache = new Map<string, Promise<PageText>>();

const keyFor = (page: PageState) => `${page.sourceId ?? 'blank'}:${page.sourceIndex}:${page.rotation}`;

/** Extracted text for a model page, memoised per source page and rotation. */
export function getPageText(doc: EditorDocument, page: PageState): Promise<PageText> {
  if (!page.sourceId) return Promise.resolve(EMPTY);
  const key = keyFor(page);
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const source = doc.sources[page.sourceId as string];
    if (!source) return EMPTY;
    const pdf = await openPdf(page.sourceId as string, source.bytes, source.password);
    if (page.sourceIndex >= pdf.numPages) return EMPTY;
    const pdfPage = await pdf.getPage(page.sourceIndex + 1);
    return extractPageText(pdfPage, page.rotation);
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

export const clearPageTextCache = () => cache.clear();

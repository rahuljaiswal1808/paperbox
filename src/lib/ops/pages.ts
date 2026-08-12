/**
 * Pure page-level transforms on the document model. Every function returns new
 * objects so the undo stack can hold on to the previous value cheaply.
 */
import type { Bookmark, EditorDocument, PageState } from '../../types/document';
import { uid } from '../util/misc';

export const clonePage = (page: PageState): PageState => ({
  ...page,
  id: uid('pg'),
  crop: page.crop ? { ...page.crop } : undefined,
  objects: page.objects.map((o) => ({ ...o, id: uid(o.kind) })),
});

export function movePages(pages: PageState[], from: number[], to: number): PageState[] {
  const moving = from.map((i) => pages[i]).filter(Boolean);
  const rest = pages.filter((_, i) => !from.includes(i));
  const before = from.filter((i) => i < to).length;
  const insertAt = Math.max(0, Math.min(rest.length, to - before));
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

/** Remap bookmark targets after pages move, duplicate or disappear. */
export function remapBookmarks(
  bookmarks: Bookmark[],
  oldPages: PageState[],
  newPages: PageState[],
): Bookmark[] {
  const newIndexById = new Map(newPages.map((p, i) => [p.id, i]));
  const map = (bookmark: Bookmark): Bookmark | null => {
    const oldPage = oldPages[bookmark.pageIndex];
    const target = oldPage ? newIndexById.get(oldPage.id) : undefined;
    const children = bookmark.children.map(map).filter((b): b is Bookmark => b !== null);
    if (target === undefined) {
      // Page is gone: keep the children, drop the entry itself if it had none.
      return children.length > 0 ? { ...bookmark, pageIndex: 0, children } : null;
    }
    return { ...bookmark, pageIndex: target, children };
  };
  return bookmarks.map(map).filter((b): b is Bookmark => b !== null);
}

/** A document containing only the given pages, with unused sources dropped. */
export function subsetDocument(doc: EditorDocument, indexes: number[], name: string): EditorDocument {
  const pages = indexes.map((i) => doc.pages[i]).filter(Boolean);
  const usedSources = new Set(pages.map((p) => p.sourceId).filter(Boolean) as string[]);
  const usedAssets = new Set(
    pages.flatMap((p) => p.objects.flatMap((o) => (o.kind === 'image' ? [o.assetId] : []))),
  );

  return {
    ...doc,
    id: uid('doc'),
    name,
    pages,
    sources: Object.fromEntries(Object.entries(doc.sources).filter(([id]) => usedSources.has(id))),
    assets: Object.fromEntries(Object.entries(doc.assets).filter(([id]) => usedAssets.has(id))),
    bookmarks: remapBookmarks(doc.bookmarks, doc.pages, pages),
  };
}

/** Drop sources and assets nothing references any more. */
export function collectGarbage(doc: EditorDocument): EditorDocument {
  const usedSources = new Set(doc.pages.map((p) => p.sourceId).filter(Boolean) as string[]);
  const usedAssets = new Set(
    doc.pages.flatMap((p) => p.objects.flatMap((o) => (o.kind === 'image' ? [o.assetId] : []))),
  );
  return {
    ...doc,
    sources: Object.fromEntries(Object.entries(doc.sources).filter(([id]) => usedSources.has(id))),
    assets: Object.fromEntries(Object.entries(doc.assets).filter(([id]) => usedAssets.has(id))),
  };
}


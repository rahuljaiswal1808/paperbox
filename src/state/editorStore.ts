/**
 * The editor's single source of truth.
 *
 * Undo/redo is snapshot based: a snapshot is a shallow copy of the document, so
 * pages and objects that did not change are shared between snapshots and the
 * (potentially very large) source byte arrays are never copied. `pushHistory`
 * is called once per user-visible action — at the *start* of a drag, not on
 * every mouse move — which is what makes one Ctrl+Z undo one gesture.
 */
import { create } from 'zustand';
import type {
  Asset,
  Bookmark,
  DocumentMetadata,
  EditorDocument,
  FontFamily,
  MarkupKind,
  PageObject,
  PageState,
  Rect,
  ShapeKind,
  FormFieldKind,
} from '../types/document';
import { collectGarbage, clonePage, movePages, remapBookmarks } from '../lib/ops/pages';
import { rotatePage } from '../lib/pdf/geometry';
import { blankPage } from '../lib/ops/documentFactory';
import { uid } from '../lib/util/misc';

export type ToolId =
  | 'select'
  | 'pan'
  | 'text'
  | 'edit-text'
  | 'image'
  | 'shape'
  | 'ink'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'signature'
  | 'redact'
  | 'field'
  | 'crop';

export interface ToolSettings {
  color: string;
  fillColor: string | null;
  strokeWidth: number;
  highlightColor: string;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  shape: ShapeKind;
  fieldKind: FormFieldKind;
  markup: MarkupKind;
}

export type ZoomMode = number | 'fit-width' | 'fit-page';
export type SidebarTab = 'thumbnails' | 'outline' | 'search' | 'properties' | null;

const HISTORY_LIMIT = 60;

export interface HistoryEntry {
  label: string;
  doc: EditorDocument;
}

interface EditorState {
  doc: EditorDocument | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Bumped whenever a page's rendered content changes, to invalidate caches. */
  renderEpoch: Record<string, number>;
  dirty: boolean;

  currentPage: number;
  zoom: ZoomMode;
  sidebar: SidebarTab;
  tool: ToolId;
  toolSettings: ToolSettings;
  selectedObjectIds: string[];
  selectedPageIndexes: number[];
  editingObjectId: string | null;
  fullscreen: boolean;

  // -------------------------------------------------------------- document
  setDocument: (doc: EditorDocument | null, options?: { markClean?: boolean }) => void;
  renameDocument: (name: string) => void;
  setMetadata: (patch: Partial<DocumentMetadata>) => void;
  setBookmarks: (bookmarks: Bookmark[]) => void;
  addAsset: (asset: Asset) => void;
  markSaved: () => void;

  // --------------------------------------------------------------- history
  pushHistory: (label: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  lastActionLabel: () => string | null;

  // ----------------------------------------------------------------- pages
  update: (updater: (doc: EditorDocument) => EditorDocument, label?: string) => void;
  updatePage: (index: number, updater: (page: PageState) => PageState, label?: string) => void;
  invalidatePage: (pageId: string) => void;
  insertPages: (pages: PageState[], at: number, label?: string) => void;
  addBlankPage: (at?: number) => void;
  duplicatePages: (indexes: number[]) => void;
  deletePages: (indexes: number[]) => void;
  reorderPages: (from: number[], to: number) => void;
  rotatePages: (indexes: number[], delta: 90 | 180 | 270) => void;
  setCrop: (indexes: number[], crop: Rect | undefined) => void;

  // --------------------------------------------------------------- objects
  addObject: (pageIndex: number, object: PageObject, label?: string) => void;
  updateObject: (objectId: string, patch: Partial<PageObject>, label?: string) => void;
  removeObjects: (objectIds: string[], label?: string) => void;
  bringForward: (objectId: string, direction: 1 | -1) => void;

  // ------------------------------------------------------------------ view
  setCurrentPage: (index: number) => void;
  setZoom: (zoom: ZoomMode) => void;
  zoomBy: (factor: number) => void;
  setSidebar: (tab: SidebarTab) => void;
  setTool: (tool: ToolId) => void;
  setToolSettings: (patch: Partial<ToolSettings>) => void;
  selectObjects: (ids: string[]) => void;
  toggleObjectSelection: (id: string, additive: boolean) => void;
  setEditingObject: (id: string | null) => void;
  selectPages: (indexes: number[]) => void;
  togglePageSelection: (index: number, additive: boolean, range: boolean) => void;
  setFullscreen: (value: boolean) => void;
  reset: () => void;
}

const defaultToolSettings: ToolSettings = {
  color: '#ef4444',
  fillColor: null,
  strokeWidth: 2,
  highlightColor: '#fde047',
  fontSize: 14,
  fontFamily: 'Helvetica',
  bold: false,
  italic: false,
  shape: 'rectangle',
  fieldKind: 'text',
  markup: 'highlight',
};

const touch = (doc: EditorDocument): EditorDocument => ({ ...doc, updatedAt: Date.now() });

export const useEditorStore = create<EditorState>()((set, get) => ({
  doc: null,
  past: [],
  future: [],
  renderEpoch: {},
  dirty: false,

  currentPage: 0,
  zoom: 'fit-width',
  sidebar: 'thumbnails',
  tool: 'select',
  toolSettings: defaultToolSettings,
  selectedObjectIds: [],
  selectedPageIndexes: [],
  editingObjectId: null,
  fullscreen: false,

  setDocument: (doc, options) =>
    set({
      doc,
      past: [],
      future: [],
      renderEpoch: {},
      dirty: doc ? !options?.markClean : false,
      currentPage: 0,
      selectedObjectIds: [],
      selectedPageIndexes: doc && doc.pages.length > 0 ? [0] : [],
      editingObjectId: null,
      tool: 'select',
    }),

  renameDocument: (name) => get().update((doc) => ({ ...doc, name }), 'Rename document'),

  setMetadata: (patch) =>
    get().update((doc) => ({ ...doc, metadata: { ...doc.metadata, ...patch } }), 'Edit metadata'),

  setBookmarks: (bookmarks) => get().update((doc) => ({ ...doc, bookmarks }), 'Edit bookmarks'),

  addAsset: (asset) =>
    set((state) =>
      state.doc
        ? { doc: { ...state.doc, assets: { ...state.doc.assets, [asset.id]: asset } } }
        : state,
    ),

  markSaved: () => set({ dirty: false }),

  pushHistory: (label) =>
    set((state) => {
      if (!state.doc) return state;
      const past = [...state.past, { label, doc: state.doc }].slice(-HISTORY_LIMIT);
      return { past, future: [] };
    }),

  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous || !state.doc) return state;
      return {
        doc: previous.doc,
        past: state.past.slice(0, -1),
        future: [{ label: previous.label, doc: state.doc }, ...state.future].slice(0, HISTORY_LIMIT),
        dirty: true,
        editingObjectId: null,
        currentPage: Math.min(state.currentPage, Math.max(0, previous.doc.pages.length - 1)),
        selectedObjectIds: [],
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next || !state.doc) return state;
      return {
        doc: next.doc,
        past: [...state.past, { label: next.label, doc: state.doc }].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        dirty: true,
        editingObjectId: null,
        currentPage: Math.min(state.currentPage, Math.max(0, next.doc.pages.length - 1)),
        selectedObjectIds: [],
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  lastActionLabel: () => get().past.at(-1)?.label ?? null,

  update: (updater, label) =>
    set((state) => {
      if (!state.doc) return state;
      const past = label ? [...state.past, { label, doc: state.doc }].slice(-HISTORY_LIMIT) : state.past;
      return {
        doc: touch(updater(state.doc)),
        past,
        future: label ? [] : state.future,
        dirty: true,
      };
    }),

  updatePage: (index, updater, label) =>
    get().update(
      (doc) => ({
        ...doc,
        pages: doc.pages.map((page, i) => (i === index ? updater(page) : page)),
      }),
      label,
    ),

  invalidatePage: (pageId) =>
    set((state) => ({
      renderEpoch: { ...state.renderEpoch, [pageId]: (state.renderEpoch[pageId] ?? 0) + 1 },
    })),

  insertPages: (pages, at, label = 'Insert pages') =>
    get().update((doc) => {
      const next = [...doc.pages];
      next.splice(at, 0, ...pages);
      return { ...doc, pages: next, bookmarks: remapBookmarks(doc.bookmarks, doc.pages, next) };
    }, label),

  addBlankPage: (at) => {
    const state = get();
    const doc = state.doc;
    if (!doc) return;
    const reference = doc.pages[Math.min(state.currentPage, doc.pages.length - 1)];
    const page = blankPage(reference?.width, reference?.height);
    const index = at ?? state.currentPage + 1;
    state.insertPages([page], Math.min(index, doc.pages.length), 'Add blank page');
    set({ currentPage: Math.min(index, get().doc?.pages.length ?? 1) });
  },

  duplicatePages: (indexes) => {
    if (indexes.length === 0) return;
    get().update((doc) => {
      const next: PageState[] = [];
      doc.pages.forEach((page, i) => {
        next.push(page);
        if (indexes.includes(i)) next.push(clonePage(page));
      });
      return { ...doc, pages: next, bookmarks: remapBookmarks(doc.bookmarks, doc.pages, next) };
    }, indexes.length > 1 ? `Duplicate ${indexes.length} pages` : 'Duplicate page');
  },

  deletePages: (indexes) => {
    const state = get();
    if (!state.doc || indexes.length === 0) return;
    if (indexes.length >= state.doc.pages.length) return; // never leave an empty document
    state.update((doc) => {
      const next = doc.pages.filter((_, i) => !indexes.includes(i));
      return collectGarbage({
        ...doc,
        pages: next,
        bookmarks: remapBookmarks(doc.bookmarks, doc.pages, next),
      });
    }, indexes.length > 1 ? `Delete ${indexes.length} pages` : 'Delete page');
    const remaining = get().doc?.pages.length ?? 0;
    const nextIndex = Math.max(0, Math.min(Math.min(...indexes), remaining - 1));
    set({ currentPage: nextIndex, selectedPageIndexes: [nextIndex], selectedObjectIds: [] });
  },

  reorderPages: (from, to) => {
    get().update((doc) => {
      const next = movePages(doc.pages, from, to);
      return { ...doc, pages: next, bookmarks: remapBookmarks(doc.bookmarks, doc.pages, next) };
    }, 'Reorder pages');
    const moved = get().doc?.pages ?? [];
    const before = from.filter((i) => i < to).length;
    const start = Math.max(0, Math.min(moved.length - 1, to - before));
    set({
      selectedPageIndexes: from.map((_, i) => start + i),
      currentPage: start,
    });
  },

  rotatePages: (indexes, delta) => {
    if (indexes.length === 0) return;
    get().update(
      (doc) => ({
        ...doc,
        pages: doc.pages.map((page, i) => (indexes.includes(i) ? rotatePage(page, delta) : page)),
      }),
      indexes.length > 1 ? `Rotate ${indexes.length} pages` : 'Rotate page',
    );
    const doc = get().doc;
    if (doc) for (const i of indexes) get().invalidatePage(doc.pages[i].id);
  },

  setCrop: (indexes, crop) => {
    if (indexes.length === 0) return;
    get().update(
      (doc) => ({
        ...doc,
        pages: doc.pages.map((page, i) => (indexes.includes(i) ? { ...page, crop } : page)),
      }),
      crop ? 'Crop pages' : 'Remove crop',
    );
  },

  addObject: (pageIndex, object, label = 'Add annotation') => {
    get().updatePage(pageIndex, (page) => ({ ...page, objects: [...page.objects, object] }), label);
    set({ selectedObjectIds: [object.id] });
  },

  updateObject: (objectId, patch, label) =>
    get().update(
      (doc) => ({
        ...doc,
        pages: doc.pages.map((page) =>
          page.objects.some((o) => o.id === objectId)
            ? {
                ...page,
                objects: page.objects.map((o) =>
                  o.id === objectId ? ({ ...o, ...patch } as PageObject) : o,
                ),
              }
            : page,
        ),
      }),
      label,
    ),

  removeObjects: (objectIds, label = 'Delete selection') => {
    if (objectIds.length === 0) return;
    get().update(
      (doc) => ({
        ...doc,
        pages: doc.pages.map((page) =>
          page.objects.some((o) => objectIds.includes(o.id))
            ? { ...page, objects: page.objects.filter((o) => !objectIds.includes(o.id)) }
            : page,
        ),
      }),
      label,
    );
    set({ selectedObjectIds: [], editingObjectId: null });
  },

  bringForward: (objectId, direction) =>
    get().update(
      (doc) => ({
        ...doc,
        pages: doc.pages.map((page) => {
          const index = page.objects.findIndex((o) => o.id === objectId);
          if (index < 0) return page;
          const target = Math.max(0, Math.min(page.objects.length - 1, index + direction));
          if (target === index) return page;
          const objects = [...page.objects];
          const [moved] = objects.splice(index, 1);
          objects.splice(target, 0, moved);
          return { ...page, objects };
        }),
      }),
      direction > 0 ? 'Bring forward' : 'Send backward',
    ),

  setCurrentPage: (index) =>
    set((state) => {
      const count = state.doc?.pages.length ?? 0;
      const next = Math.max(0, Math.min(count - 1, index));
      return { currentPage: next, selectedPageIndexes: [next] };
    }),

  setZoom: (zoom) => set({ zoom }),

  zoomBy: (factor) =>
    set((state) => {
      const current = typeof state.zoom === 'number' ? state.zoom : 1;
      return { zoom: Math.max(0.1, Math.min(8, Number((current * factor).toFixed(3)))) };
    }),

  setSidebar: (tab) => set((state) => ({ sidebar: state.sidebar === tab ? null : tab })),

  setTool: (tool) =>
    set((state) => ({
      tool,
      selectedObjectIds: tool === 'select' ? state.selectedObjectIds : [],
      editingObjectId: null,
    })),

  setToolSettings: (patch) =>
    set((state) => ({ toolSettings: { ...state.toolSettings, ...patch } })),

  selectObjects: (ids) => set({ selectedObjectIds: ids }),

  toggleObjectSelection: (id, additive) =>
    set((state) => {
      if (!additive) return { selectedObjectIds: [id] };
      return state.selectedObjectIds.includes(id)
        ? { selectedObjectIds: state.selectedObjectIds.filter((o) => o !== id) }
        : { selectedObjectIds: [...state.selectedObjectIds, id] };
    }),

  setEditingObject: (id) => set({ editingObjectId: id }),

  selectPages: (indexes) =>
    set({ selectedPageIndexes: indexes, currentPage: indexes[0] ?? 0 }),

  togglePageSelection: (index, additive, range) =>
    set((state) => {
      if (range && state.selectedPageIndexes.length > 0) {
        const anchor = state.selectedPageIndexes[0];
        const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
        const span = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        return { selectedPageIndexes: span, currentPage: index };
      }
      if (additive) {
        const has = state.selectedPageIndexes.includes(index);
        const next = has
          ? state.selectedPageIndexes.filter((i) => i !== index)
          : [...state.selectedPageIndexes, index];
        return { selectedPageIndexes: next.length ? next : [index], currentPage: index };
      }
      return { selectedPageIndexes: [index], currentPage: index };
    }),

  setFullscreen: (value) => set({ fullscreen: value }),

  reset: () =>
    set({
      doc: null,
      past: [],
      future: [],
      dirty: false,
      currentPage: 0,
      selectedObjectIds: [],
      selectedPageIndexes: [],
      editingObjectId: null,
      tool: 'select',
      zoom: 'fit-width',
    }),
}));

// ------------------------------------------------------------------ helpers

export const newObjectId = uid;

export const selectCurrentPageState = (state: EditorState): PageState | null =>
  state.doc?.pages[state.currentPage] ?? null;

export const findObject = (
  doc: EditorDocument | null,
  objectId: string | null,
): { object: PageObject; pageIndex: number } | null => {
  if (!doc || !objectId) return null;
  for (let i = 0; i < doc.pages.length; i += 1) {
    const object = doc.pages[i].objects.find((o) => o.id === objectId);
    if (object) return { object, pageIndex: i };
  }
  return null;
};

// Exposed for automated smoke tests and power-user debugging from the console.
// Read-only in spirit: it is the same store the UI uses.
declare global {
  interface Window {
    __paperbox?: typeof useEditorStore;
  }
}

if (typeof window !== 'undefined') {
  window.__paperbox = useEditorStore;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore, type ToolId } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { useSearchStore } from '../state/searchStore';
import { saveSession } from '../lib/storage/db';
import { debounce, isTypingTarget } from '../lib/util/misc';
import { closeDocument, exportDocument, promptOpenPdf } from './actions';
import type { PageText } from '../lib/pdf/text';
import { getPageText } from '../lib/pdf/pageTextCache';
import type { PageState } from '../types/document';

/** Persist the document to IndexedDB shortly after edits stop. */
export function useAutosave(enabled = true) {
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const save = debounce((doc: Parameters<typeof saveSession>[0]) => {
      saveSession(doc)
        .then(() => setSavedAt(Date.now()))
        .catch(() => undefined);
    }, 1500);

    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.doc && state.doc !== previous.doc) save(state.doc);
    });

    return () => {
      save.cancel();
      unsubscribe();
    };
  }, [enabled]);

  return savedAt;
}

/** Warn before losing unsaved work when the tab closes. */
export function useUnloadGuard() {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!useEditorStore.getState().dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}

export interface Shortcut {
  keys: string;
  label: string;
  group: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl/⌘ O', label: 'Open PDF', group: 'File' },
  { keys: 'Ctrl/⌘ S', label: 'Export PDF', group: 'File' },
  { keys: 'Ctrl/⌘ W', label: 'Close document', group: 'File' },
  { keys: 'Ctrl/⌘ Z', label: 'Undo', group: 'Edit' },
  { keys: 'Ctrl/⌘ ⇧ Z', label: 'Redo', group: 'Edit' },
  { keys: 'Delete', label: 'Delete selection', group: 'Edit' },
  { keys: 'Ctrl/⌘ A', label: 'Select all objects on page', group: 'Edit' },
  { keys: 'Ctrl/⌘ F', label: 'Find in document', group: 'Navigate' },
  { keys: 'Enter / ⇧ Enter', label: 'Next / previous match', group: 'Navigate' },
  { keys: '← →  ↑ ↓', label: 'Nudge selection (⇧ for 10pt)', group: 'Edit' },
  { keys: 'Page Up / Page Down', label: 'Previous / next page', group: 'Navigate' },
  { keys: 'Home / End', label: 'First / last page', group: 'Navigate' },
  { keys: 'Ctrl/⌘ + / -', label: 'Zoom in / out', group: 'View' },
  { keys: 'Ctrl/⌘ 0', label: 'Fit width', group: 'View' },
  { keys: 'F11', label: 'Fullscreen', group: 'View' },
  { keys: 'V', label: 'Select tool', group: 'Tools' },
  { keys: 'H', label: 'Pan tool', group: 'Tools' },
  { keys: 'T', label: 'Text box', group: 'Tools' },
  { keys: 'E', label: 'Edit existing text', group: 'Tools' },
  { keys: 'D', label: 'Draw (freehand)', group: 'Tools' },
  { keys: 'S', label: 'Shape', group: 'Tools' },
  { keys: 'G', label: 'Highlight', group: 'Tools' },
  { keys: 'N', label: 'Sticky note', group: 'Tools' },
  { keys: 'R', label: 'Redact', group: 'Tools' },
  { keys: '?', label: 'This list', group: 'Help' },
];

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'pan',
  t: 'text',
  e: 'edit-text',
  d: 'ink',
  s: 'shape',
  g: 'highlight',
  n: 'note',
  r: 'redact',
  c: 'crop',
  f: 'field',
};

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editor = useEditorStore.getState();
      const ui = useUiStore.getState();
      const mod = event.ctrlKey || event.metaKey;
      const typing = isTypingTarget(event.target);

      if (event.key === 'F11') {
        event.preventDefault();
        editor.setFullscreen(!editor.fullscreen);
        return;
      }

      if (mod) {
        switch (event.key.toLowerCase()) {
          case 'o':
            event.preventDefault();
            void promptOpenPdf();
            return;
          case 's':
            event.preventDefault();
            if (editor.doc) void exportDocument();
            return;
          case 'w':
            event.preventDefault();
            if (editor.doc) void closeDocument();
            return;
          case 'z':
            if (typing) return;
            event.preventDefault();
            if (event.shiftKey) editor.redo();
            else editor.undo();
            return;
          case 'y':
            if (typing) return;
            event.preventDefault();
            editor.redo();
            return;
          case 'f':
            event.preventDefault();
            useEditorStore.setState({ sidebar: 'search' });
            requestAnimationFrame(() =>
              document.getElementById('search-input')?.focus(),
            );
            return;
          case 'a': {
            if (typing || !editor.doc) return;
            event.preventDefault();
            const page = editor.doc.pages[editor.currentPage];
            if (page) editor.selectObjects(page.objects.map((o) => o.id));
            return;
          }
          case '=':
          case '+':
            event.preventDefault();
            editor.zoomBy(1.2);
            return;
          case '-':
            event.preventDefault();
            editor.zoomBy(1 / 1.2);
            return;
          case '0':
            event.preventDefault();
            editor.setZoom('fit-width');
            return;
          default:
            return;
        }
      }

      if (typing) return;
      if (!editor.doc) return;

      switch (event.key) {
        case 'Escape':
          if (ui.dialog) return;
          editor.setEditingObject(null);
          editor.selectObjects([]);
          if (editor.tool !== 'select') editor.setTool('select');
          else if (editor.fullscreen) editor.setFullscreen(false);
          return;
        case 'Delete':
        case 'Backspace':
          if (editor.selectedObjectIds.length > 0) {
            event.preventDefault();
            editor.removeObjects(editor.selectedObjectIds);
          }
          return;
        case 'PageDown':
          event.preventDefault();
          editor.setCurrentPage(editor.currentPage + 1);
          return;
        case 'PageUp':
          event.preventDefault();
          editor.setCurrentPage(editor.currentPage - 1);
          return;
        case 'Home':
          event.preventDefault();
          editor.setCurrentPage(0);
          return;
        case 'End':
          event.preventDefault();
          editor.setCurrentPage((editor.doc?.pages.length ?? 1) - 1);
          return;
        case '?':
          ui.openDialog('shortcuts');
          return;
        default:
          break;
      }

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = arrows[event.key];
      if (delta && editor.selectedObjectIds.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const doc = editor.doc;
        const label = 'Move selection';
        editor.update(
          (current) => ({
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              objects: page.objects.map((object) =>
                editor.selectedObjectIds.includes(object.id)
                  ? { ...object, x: object.x + delta[0] * step, y: object.y + delta[1] * step }
                  : object,
              ),
            })),
          }),
          doc ? label : undefined,
        );
        return;
      }

      if (delta) {
        event.preventDefault();
        editor.setCurrentPage(editor.currentPage + (delta[1] > 0 ? 1 : delta[1] < 0 ? -1 : 0));
        return;
      }

      const tool = TOOL_KEYS[event.key.toLowerCase()];
      if (tool && !event.altKey) editor.setTool(tool);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Apply the chosen colour theme to the document element. */
export function useTheme() {
  const theme = useUiStore((state) => state.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.classList.toggle('is-dark', theme === 'dark' || (theme === 'system' && media.matches));
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/** Extracted text for a page, loaded lazily. */
export function usePageText(page: PageState | null): PageText | null {
  const doc = useEditorStore((state) => state.doc);
  const [text, setText] = useState<PageText | null>(null);

  useEffect(() => {
    let active = true;
    if (!doc || !page) {
      setText(null);
      return () => {
        active = false;
      };
    }
    getPageText(doc, page)
      .then((result) => {
        if (active) setText(result);
      })
      .catch(() => {
        if (active) setText(null);
      });
    return () => {
      active = false;
    };
  }, [doc, page]);

  return text;
}

/** Re-runs the document search when the query or options change. */
export function useLiveSearch() {
  const doc = useEditorStore((state) => state.doc);
  const query = useSearchStore((state) => state.query);
  const matchCase = useSearchStore((state) => state.matchCase);
  const wholeWord = useSearchStore((state) => state.wholeWord);

  useEffect(() => {
    if (!doc) return undefined;
    const timer = setTimeout(() => {
      void useSearchStore.getState().run(doc);
    }, 220);
    return () => clearTimeout(timer);
  }, [doc, query, matchCase, wholeWord]);
}

/** Window-level drag & drop for opening files anywhere in the app. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      depth.current += 1;
      setActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      depth.current = 0;
      setActive(false);
      onFiles([...event.dataTransfer.files]);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFiles]);

  return active;
}

/**
 * Element size, for fit-to-width/page zoom.
 *
 * Uses a callback ref rather than an object ref so the observer attaches even
 * when the measured element only appears after a later render (the viewer swaps
 * in its real container once a document is open).
 */
export function useElementSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!node) return undefined;
    setSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return useMemo(() => ({ ref: setNode, ...size }), [size]);
}

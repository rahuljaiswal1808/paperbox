import { create } from 'zustand';
import type { EditorDocument, Rect } from '../types/document';
import { getPageText } from '../lib/pdf/pageTextCache';
import { findInPage, rectsForRange } from '../lib/pdf/text';

export interface SearchHit {
  pageIndex: number;
  rects: Rect[];
  preview: string;
}

interface SearchState {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  hits: SearchHit[];
  activeIndex: number;
  running: boolean;
  searchedPages: number;
  totalPages: number;

  setQuery: (query: string) => void;
  setOption: (patch: { matchCase?: boolean; wholeWord?: boolean }) => void;
  run: (doc: EditorDocument) => Promise<void>;
  clear: () => void;
  goTo: (index: number) => void;
  next: () => void;
  previous: () => void;
  hitsForPage: (pageIndex: number) => { hit: SearchHit; index: number }[];
}

let runToken = 0;

export const useSearchStore = create<SearchState>()((set, get) => ({
  query: '',
  matchCase: false,
  wholeWord: false,
  hits: [],
  activeIndex: 0,
  running: false,
  searchedPages: 0,
  totalPages: 0,

  setQuery: (query) => set({ query }),
  setOption: (patch) => set(patch),

  run: async (doc) => {
    const { query, matchCase, wholeWord } = get();
    const token = ++runToken;
    if (!query.trim()) {
      set({ hits: [], running: false, activeIndex: 0, searchedPages: 0, totalPages: 0 });
      return;
    }

    set({ running: true, hits: [], activeIndex: 0, searchedPages: 0, totalPages: doc.pages.length });
    const hits: SearchHit[] = [];

    for (let i = 0; i < doc.pages.length; i += 1) {
      if (token !== runToken) return;
      const page = doc.pages[i];
      const pageText = await getPageText(doc, page);
      for (const match of findInPage(pageText, query, { matchCase, wholeWord })) {
        hits.push({
          pageIndex: i,
          rects: rectsForRange(pageText, match.start, match.end),
          preview: match.preview,
        });
      }
      // Text the user typed in the editor is searchable too.
      for (const object of page.objects) {
        const text =
          object.kind === 'text' ? object.text : object.kind === 'note' ? object.text : '';
        if (!text) continue;
        const haystack = matchCase ? text : text.toLowerCase();
        const needle = matchCase ? query : query.toLowerCase();
        if (haystack.includes(needle)) {
          hits.push({
            pageIndex: i,
            rects: [{ x: object.x, y: object.y, width: object.width, height: object.height }],
            preview: text.slice(0, 80),
          });
        }
      }
      set({ hits: [...hits], searchedPages: i + 1 });
    }

    if (token === runToken) set({ running: false });
  },

  clear: () => {
    runToken += 1;
    set({ query: '', hits: [], activeIndex: 0, running: false, searchedPages: 0 });
  },

  goTo: (index) => set({ activeIndex: index }),

  next: () =>
    set((state) =>
      state.hits.length === 0 ? state : { activeIndex: (state.activeIndex + 1) % state.hits.length },
    ),

  previous: () =>
    set((state) =>
      state.hits.length === 0
        ? state
        : { activeIndex: (state.activeIndex - 1 + state.hits.length) % state.hits.length },
    ),

  hitsForPage: (pageIndex) =>
    get()
      .hits.map((hit, index) => ({ hit, index }))
      .filter((entry) => entry.hit.pageIndex === pageIndex),
}));

import { useState } from 'react';
import { useEditorStore, type SidebarTab } from '../../state/editorStore';
import { useSearchStore } from '../../state/searchStore';
import { useUiStore } from '../../state/uiStore';
import { Icon, type IconName } from '../ui/Icon';
import { Button, Checkbox, TextInput } from '../ui/controls';
import { Thumbnails } from './Thumbnails';
import type { Bookmark } from '../../types/document';
import { uid } from '../../lib/util/misc';

const TABS: { id: Exclude<SidebarTab, null>; icon: IconName; label: string }[] = [
  { id: 'thumbnails', icon: 'layers', label: 'Page thumbnails' },
  { id: 'outline', icon: 'list', label: 'Bookmarks' },
  { id: 'search', icon: 'search', label: 'Search' },
];

export function Sidebar() {
  const sidebar = useEditorStore((state) => state.sidebar);
  const setSidebar = useEditorStore((state) => state.setSidebar);
  if (!sidebar) return null;

  return (
    <aside className="sidebar" aria-label="Document navigation">
      <div className="sidebar__tabs" role="tablist" aria-label="Sidebar sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="sidebar__tab"
            aria-selected={sidebar === tab.id}
            aria-label={tab.label}
            title={tab.label}
            onClick={() => setSidebar(tab.id)}
          >
            <Icon name={tab.icon} size={16} />
          </button>
        ))}
      </div>
      <div className="sidebar__body">
        {sidebar === 'thumbnails' && <Thumbnails />}
        {sidebar === 'outline' && <OutlinePanel />}
        {sidebar === 'search' && <SearchPanel />}
      </div>
    </aside>
  );
}

function OutlinePanel() {
  const doc = useEditorStore((state) => state.doc);
  const setBookmarks = useEditorStore((state) => state.setBookmarks);
  const setCurrentPage = useEditorStore((state) => state.setCurrentPage);
  const currentPage = useEditorStore((state) => state.currentPage);
  const openDialog = useUiStore((state) => state.openDialog);

  if (!doc) return <div className="empty">No document open.</div>;

  const addHere = () => {
    const title = window.prompt('Bookmark title', `Page ${currentPage + 1}`);
    if (title === null) return;
    const bookmark: Bookmark = { id: uid('bm'), title, pageIndex: currentPage, children: [] };
    setBookmarks([...doc.bookmarks, bookmark].sort((a, b) => a.pageIndex - b.pageIndex));
  };

  const remove = (id: string) => {
    const strip = (list: Bookmark[]): Bookmark[] =>
      list.filter((b) => b.id !== id).map((b) => ({ ...b, children: strip(b.children) }));
    setBookmarks(strip(doc.bookmarks));
  };

  const render = (items: Bookmark[], depth = 0) =>
    items.map((bookmark) => (
      <div key={bookmark.id}>
        <div className="list-row" style={{ paddingLeft: 12 + depth * 14 }}>
          <button
            type="button"
            className="grow"
            style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
            onClick={() => setCurrentPage(bookmark.pageIndex)}
          >
            <Icon name="bookmark" size={13} /> {bookmark.title}
            <span className="muted small"> · p{bookmark.pageIndex + 1}</span>
          </button>
          <Button
            icon="trash"
            iconOnly
            size="sm"
            aria-label={`Delete bookmark ${bookmark.title}`}
            onClick={() => remove(bookmark.id)}
          />
        </div>
        {render(bookmark.children, depth + 1)}
      </div>
    ));

  return (
    <div>
      <div className="sidebar__section-title">Bookmarks</div>
      {doc.bookmarks.length === 0 ? (
        <div className="empty">
          No bookmarks yet.
          <br />
          They are written into the exported PDF.
        </div>
      ) : (
        render(doc.bookmarks)
      )}
      <div style={{ padding: 10, display: 'flex', gap: 6 }}>
        <Button icon="plus" size="sm" variant="outline" onClick={addHere}>
          Add here
        </Button>
        <Button size="sm" onClick={() => openDialog('bookmarks')}>
          Manage
        </Button>
      </div>
    </div>
  );
}

function SearchPanel() {
  const doc = useEditorStore((state) => state.doc);
  const setCurrentPage = useEditorStore((state) => state.setCurrentPage);
  const {
    query,
    setQuery,
    hits,
    activeIndex,
    running,
    searchedPages,
    totalPages,
    matchCase,
    wholeWord,
    setOption,
    goTo,
    next,
    previous,
  } = useSearchStore();
  const [showOptions, setShowOptions] = useState(false);

  return (
    <div style={{ padding: 10 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <TextInput
          id="search-input"
          value={query}
          placeholder="Find in document"
          aria-label="Find in document"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (event.shiftKey) previous();
            else next();
            const hit = useSearchStore.getState().hits[useSearchStore.getState().activeIndex];
            if (hit) setCurrentPage(hit.pageIndex);
          }}
        />
        <Button
          icon="settings"
          iconOnly
          aria-label="Search options"
          active={showOptions}
          onClick={() => setShowOptions((value) => !value)}
        />
      </div>

      {showOptions && (
        <div style={{ marginBottom: 8 }}>
          <Checkbox checked={matchCase} onChange={(value) => setOption({ matchCase: value })} label="Match case" />
          <Checkbox checked={wholeWord} onChange={(value) => setOption({ wholeWord: value })} label="Whole words" />
        </div>
      )}

      <div className="row small muted" style={{ marginBottom: 6 }}>
        <span className="grow">
          {running
            ? `Searching… ${searchedPages}/${totalPages}`
            : query
              ? `${hits.length} match${hits.length === 1 ? '' : 'es'}`
              : `${doc?.pages.length ?? 0} pages`}
        </span>
        <Button icon="chevron-up" iconOnly size="sm" aria-label="Previous match" onClick={previous} disabled={hits.length === 0} />
        <Button icon="chevron-down" iconOnly size="sm" aria-label="Next match" onClick={next} disabled={hits.length === 0} />
      </div>

      <div>
        {hits.map((hit, index) => (
          <button
            key={index}
            type="button"
            className={`list-row ${index === activeIndex ? 'list-row--active' : ''}`}
            onClick={() => {
              goTo(index);
              setCurrentPage(hit.pageIndex);
            }}
          >
            <span className="muted" style={{ minWidth: 26 }}>
              p{hit.pageIndex + 1}
            </span>
            <span className="grow small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hit.preview}
            </span>
          </button>
        ))}
        {!running && query && hits.length === 0 && (
          <div className="empty">
            No matches.
            <br />
            Scanned PDFs need OCR before their text can be searched.
          </div>
        )}
      </div>
    </div>
  );
}

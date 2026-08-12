import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useElementSize } from '../../app/hooks';
import { viewRect } from '../../lib/pdf/geometry';
import { PageView } from './PageView';

const GAP = 18;
const OVERSCAN = 2;

export function Viewer() {
  const doc = useEditorStore((state) => state.doc);
  const zoomMode = useEditorStore((state) => state.zoom);
  const currentPage = useEditorStore((state) => state.currentPage);
  const tool = useEditorStore((state) => state.tool);
  const setCurrentPage = useEditorStore((state) => state.setCurrentPage);
  const zoomBy = useEditorStore((state) => state.zoomBy);

  const scrollRef = useRef<HTMLDivElement>(null);
  const container = useElementSize<HTMLDivElement>();
  const [scrollTop, setScrollTop] = useState(0);
  const programmatic = useRef(false);

  // Stable identity so the layout memos below only recompute on real changes.
  const pages = useMemo(() => doc?.pages ?? [], [doc]);

  /** Zoom resolved to a number, honouring fit-width / fit-page. */
  const zoom = useMemo(() => {
    if (typeof zoomMode === 'number') return zoomMode;
    const page = pages[Math.min(currentPage, pages.length - 1)];
    if (!page || container.width === 0) return 1;
    const view = viewRect(page);
    const available = container.width - 48;
    if (zoomMode === 'fit-width') return Math.max(0.1, available / view.width);
    const availableHeight = container.height - 48;
    return Math.max(0.1, Math.min(available / view.width, availableHeight / view.height));
  }, [zoomMode, pages, currentPage, container.width, container.height]);

  /** Vertical offset of every page, used for windowing and scroll sync. */
  const offsets = useMemo(() => {
    let y = 0;
    return pages.map((page) => {
      const view = viewRect(page);
      const entry = { top: y, height: view.height * zoom };
      y += entry.height + GAP;
      return entry;
    });
  }, [pages, zoom]);

  const totalHeight = offsets.length > 0 ? offsets[offsets.length - 1].top + offsets[offsets.length - 1].height : 0;

  const visibleRange = useMemo(() => {
    if (offsets.length === 0) return { start: 0, end: 0 };
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + (container.height || 800);
    let start = offsets.findIndex((entry) => entry.top + entry.height >= viewportTop);
    if (start < 0) start = 0;
    let end = offsets.findIndex((entry) => entry.top > viewportBottom);
    if (end < 0) end = offsets.length;
    return {
      start: Math.max(0, start - OVERSCAN),
      end: Math.min(offsets.length, end + OVERSCAN),
    };
  }, [offsets, scrollTop, container.height]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setScrollTop(node.scrollTop);
    if (programmatic.current) return;
    // Whichever page covers the middle of the viewport is "current".
    const middle = node.scrollTop + node.clientHeight / 2;
    let index = 0;
    for (let i = 0; i < offsets.length; i += 1) {
      if (offsets[i].top <= middle) index = i;
      else break;
    }
    if (index !== useEditorStore.getState().currentPage) {
      useEditorStore.setState({ currentPage: index });
    }
  }, [offsets]);

  // Scroll to the current page when it changes from outside the viewer.
  useEffect(() => {
    const node = scrollRef.current;
    const entry = offsets[currentPage];
    if (!node || !entry) return;
    const top = node.scrollTop;
    const bottom = top + node.clientHeight;
    if (entry.top >= top - 4 && entry.top + entry.height <= bottom + 4) return;
    programmatic.current = true;
    node.scrollTo({ top: Math.max(0, entry.top - 20), behavior: 'auto' });
    const timer = setTimeout(() => {
      programmatic.current = false;
    }, 60);
    return () => clearTimeout(timer);
  }, [currentPage, offsets]);

  // Ctrl/⌘ + wheel zooms, like every other document app.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Space/pan tool drag-scrolling.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || tool !== 'pan') return undefined;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let scrollX = 0;
    let scrollY = 0;

    const down = (event: PointerEvent) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      scrollX = node.scrollLeft;
      scrollY = node.scrollTop;
      node.style.cursor = 'grabbing';
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      node.scrollLeft = scrollX - (event.clientX - startX);
      node.scrollTop = scrollY - (event.clientY - startY);
    };
    const up = () => {
      dragging = false;
      node.style.cursor = '';
    };

    node.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      node.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      node.style.cursor = '';
    };
  }, [tool]);

  if (!doc) return <div className="viewer" />;

  return (
    <div className="viewer" ref={container.ref}>
      <div
        className="viewer__scroll"
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        role="region"
        aria-label={`Document pages, ${pages.length} total`}
        id="viewer-scroll"
      >
        <div className="viewer__pages" style={{ height: totalHeight, position: 'relative', width: '100%' }}>
          {pages.map((page, index) => {
            const entry = offsets[index];
            const visible = index >= visibleRange.start && index < visibleRange.end;
            const view = viewRect(page);
            return (
              <div
                key={page.id}
                style={{
                  position: 'absolute',
                  top: entry.top,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: view.width * zoom,
                  height: entry.height,
                }}
              >
                {visible ? (
                  <PageView
                    doc={doc}
                    page={page}
                    pageIndex={index}
                    zoom={zoom}
                    visible={visible}
                    isCurrent={index === currentPage}
                  />
                ) : (
                  <div className="page" style={{ width: view.width * zoom, height: entry.height }}>
                    <div className="page__placeholder">Page {index + 1}</div>
                  </div>
                )}
                <span className="page__number">
                  {index + 1} / {pages.length}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {pages.length === 0 && (
        <div className="empty" style={{ margin: 'auto' }}>
          This document has no pages.
          <div>
            <button className="btn btn--outline" type="button" onClick={() => setCurrentPage(0)}>
              Add a page from the Pages menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

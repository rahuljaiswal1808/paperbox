import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { EditorDocument, PageState } from '../../types/document';
import { useEditorStore } from '../../state/editorStore';
import { composePage } from '../../lib/pdf/raster';
import { viewRect } from '../../lib/pdf/geometry';

const THUMB_WIDTH = 130;

export function Thumbnails() {
  const doc = useEditorStore((state) => state.doc);
  const currentPage = useEditorStore((state) => state.currentPage);
  const selected = useEditorStore((state) => state.selectedPageIndexes);
  const reorderPages = useEditorStore((state) => state.reorderPages);
  const togglePageSelection = useEditorStore((state) => state.togglePageSelection);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!doc) return <div className="empty">No document open.</div>;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = doc.pages.findIndex((page) => page.id === active.id);
    const to = doc.pages.findIndex((page) => page.id === over.id);
    if (from < 0 || to < 0) return;
    const moving = selected.includes(from) ? [...selected].sort((a, b) => a - b) : [from];
    reorderPages(moving, to > from ? to + 1 : to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={doc.pages.map((page) => page.id)} strategy={verticalListSortingStrategy}>
        <div className="thumbs" role="listbox" aria-label="Page thumbnails" aria-multiselectable>
          {doc.pages.map((page, index) => (
            <Thumb
              key={page.id}
              doc={doc}
              page={page}
              index={index}
              current={index === currentPage}
              selected={selected.includes(index)}
              onSelect={(event) =>
                togglePageSelection(index, event.ctrlKey || event.metaKey, event.shiftKey)
              }
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface ThumbProps {
  doc: EditorDocument;
  page: PageState;
  index: number;
  current: boolean;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
}

function Thumb({ doc, page, index, current, selected, onSelect }: ThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const epoch = useEditorStore((state) => state.renderEpoch[page.id] ?? 0);

  const view = viewRect(page);
  const height = Math.round((THUMB_WIDTH / view.width) * view.height);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'thumb',
        selected ? 'thumb--selected' : '',
        current ? 'thumb--current' : '',
        isDragging ? 'thumb--dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          useEditorStore.getState().setCurrentPage(index);
        }
      }}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={selected}
      tabIndex={0}
    >
      <ThumbCanvas doc={doc} page={page} width={THUMB_WIDTH} height={height} epoch={epoch} />
      <span className="thumb__label">{index + 1}</span>
      {page.objects.length > 0 && (
        <span className="thumb__badge" title={`${page.objects.length} edits on this page`}>
          {page.objects.length}
        </span>
      )}
    </div>
  );
}

function ThumbCanvas({
  doc,
  page,
  width,
  height,
  epoch,
}: {
  doc: EditorDocument;
  page: PageState;
  width: number;
  height: number;
  epoch: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && setInView(true),
      { rootMargin: '250px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return undefined;
    let active = true;
    const view = viewRect(page);
    composePage(doc, page, { scale: (width * 2) / view.width })
      .then((canvas) => {
        if (active) setUrl(canvas.toDataURL('image/jpeg', 0.72));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [doc, page, width, inView, epoch]);

  return (
    <div ref={ref} style={{ width, height }}>
      {url ? (
        <img className="thumb__canvas" src={url} alt="" width={width} height={height} draggable={false} />
      ) : (
        <div className="thumb__canvas" style={{ width, height }} />
      )}
    </div>
  );
}

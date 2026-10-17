import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  EditorDocument,
  InkObject,
  MarkupKind,
  PageObject,
  PageState,
  Point,
  Rect,
} from '../../types/document';
import { useEditorStore } from '../../state/editorStore';
import { useUiStore } from '../../state/uiStore';
import { usePlacementStore } from '../../state/placementStore';
import { useSearchStore } from '../../state/searchStore';
import { usePageText } from '../../app/hooks';
import { boundsOfPoints, rectFromPoints, rectsIntersect, viewRect } from '../../lib/pdf/geometry';
import { itemsInRect, type TextItem } from '../../lib/pdf/text';
import { guessTextStyle } from '../../lib/pdf/measure';
import { getPageText } from '../../lib/pdf/pageTextCache';
import { uid } from '../../lib/util/misc';
import { PageCanvas } from './PageCanvas';
import { ObjectView } from './ObjectView';

interface PageViewProps {
  doc: EditorDocument;
  page: PageState;
  pageIndex: number;
  zoom: number;
  visible: boolean;
  isCurrent: boolean;
}

const MARKUP_TOOLS: Record<string, MarkupKind> = {
  highlight: 'highlight',
  underline: 'underline',
  strikeout: 'strikeout',
};

export function PageView({ doc, page, pageIndex, zoom, visible, isCurrent }: PageViewProps) {
  const tool = useEditorStore((state) => state.tool);
  const settings = useEditorStore((state) => state.toolSettings);
  const selectedObjectIds = useEditorStore((state) => state.selectedObjectIds);
  const editingObjectId = useEditorStore((state) => state.editingObjectId);
  const epoch = useEditorStore((state) => state.renderEpoch[page.id] ?? 0);
  const pending = usePlacementStore((state) => state.pending);
  const searchHits = useSearchStore((state) => state.hits);
  const activeHit = useSearchStore((state) => state.activeIndex);
  const pageText = usePageText(visible ? page : null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const pendingEdit = useRef<Point | null>(null);
  const [draft, setDraft] = useState<
    | { kind: 'rect'; from: Point; to: Point }
    | { kind: 'ink'; points: Point[] }
    | { kind: 'marquee'; from: Point; to: Point }
    | null
  >(null);
  const [hoverText, setHoverText] = useState<Rect | null>(null);

  const view = viewRect(page);
  const width = view.width * zoom;
  const height = view.height * zoom;

  const toPagePoint = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (event.clientX - rect.left) / zoom + view.x,
        y: (event.clientY - rect.top) / zoom + view.y,
      };
    },
    [zoom, view.x, view.y],
  );

  const store = useEditorStore;
  const interactive = tool === 'select';

  const commitObject = (object: PageObject, label: string) => {
    store.getState().addObject(pageIndex, object, label);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = toPagePoint(event);
    store.getState().setCurrentPage(pageIndex);

    // Stamping an armed signature/image happens on a plain click.
    if (pending) {
      if (!doc.assets[pending.assetId]) {
        usePlacementStore.getState().setPending(null);
        useUiStore.getState().toast({
          kind: 'error',
          title: 'That image is no longer available',
          detail: 'Create the signature again and place it.',
        });
        return;
      }
      const width0 = pending.width;
      const height0 = width0 / (pending.aspect || 1);
      commitObject(
        {
          id: uid('sig'),
          kind: 'image',
          assetId: pending.assetId,
          isSignature: pending.kind === 'signature',
          x: point.x - width0 / 2,
          y: point.y - height0 / 2,
          width: width0,
          height: height0,
          rotation: 0,
        },
        pending.kind === 'signature' ? 'Place signature' : 'Place image',
      );
      usePlacementStore.getState().setPending(null);
      store.getState().setTool('select');
      return;
    }

    switch (tool) {
      case 'select':
        store.getState().selectObjects([]);
        store.getState().setEditingObject(null);
        setDraft({ kind: 'marquee', from: point, to: point });
        break;
      case 'ink':
        setDraft({ kind: 'ink', points: [point] });
        break;
      case 'note': {
        const size = 18;
        commitObject(
          {
            id: uid('note'),
            kind: 'note',
            text: '',
            color: settings.highlightColor,
            x: point.x,
            y: point.y,
            width: size,
            height: size,
            rotation: 0,
            createdAt: Date.now(),
          },
          'Add note',
        );
        store.getState().setTool('select');
        break;
      }
      case 'edit-text':
        // Resolved on pointer *up*: the browser assigns focus from the pointer
        // gesture, and anything we focus before it settles gets blurred again.
        // The text layer may still be extracting, so the point is all we keep.
        pendingEdit.current = point;
        break;
      default:
        setDraft({ kind: 'rect', from: point, to: point });
        break;
    }
  };

  /**
   * Open the text under `point` for editing.
   *
   * Extraction is asynchronous, and a page the user has only just opened may
   * still be mid-extraction — waiting for it here is the difference between
   * "nothing happens when I click" and the tool simply working. The three ways
   * this can come up empty are genuinely different problems, so each says so.
   */
  const openTextForEditing = async (point: Point) => {
    let text = pageText;
    if (!text) {
      try {
        text = await getPageText(doc, page);
      } catch (error) {
        useUiStore.getState().toast({
          kind: 'error',
          title: 'Could not read this page\u2019s text',
          detail: (error as Error).message,
        });
        return;
      }
    }

    if (text.items.length === 0) {
      useUiStore.getState().toast({
        kind: 'warning',
        title: 'This page has no text layer',
        detail:
          'It is a scan or an image, so there are no characters to edit. Add a text box over it instead, or run OCR first.',
      });
      return;
    }

    const line = findTextLine(text.items, point);
    if (!line) {
      useUiStore.getState().toast({
        kind: 'info',
        title: 'No text at that spot',
        detail: 'Hover until a line is outlined, then click it.',
      });
      return;
    }

    replaceTextLine(line);
  };

  /**
   * Lay an editable box over a line of the source PDF: same position, same
   * baseline, and the closest match we can measure for family and weight.
   */
  const replaceTextLine = (line: TextLine) => {
    const guess = guessTextStyle(line.text, line.rect.width, line.fontSize, line.fontFamily);
    const id = uid('text');
    const top = line.rect.y;
    // Cover the glyphs from their top down past the descenders.
    const height = Math.max(line.fontSize * 1.1, line.baseline + line.fontSize * 0.25 - top);

    commitObject(
      {
        id,
        kind: 'text',
        text: line.text,
        replacesSourceText: true,
        background: '#ffffff',
        baselineOffset: line.baseline - top,
        style: {
          size: line.fontSize,
          color: '#111827',
          font: guess.font,
          bold: guess.bold,
          italic: false,
          align: 'left',
          lineHeight: 1.15,
        },
        x: line.rect.x,
        y: top,
        width: Math.max(24, line.rect.width + line.fontSize * 0.6),
        height,
        rotation: 0,
      },
      'Edit existing text',
    );

    // `setTool` clears the editing target, so switch tools before opening it.
    store.getState().setTool('select');
    store.getState().selectObjects([id]);
    store.getState().setEditingObject(id);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = toPagePoint(event);

    if (tool === 'edit-text' && pageText && !draft) {
      const item = findTextLine(pageText.items, point);
      setHoverText(item ? item.rect : null);
    }

    if (!draft) return;
    if (draft.kind === 'ink') {
      setDraft({ kind: 'ink', points: [...draft.points, point] });
      return;
    }
    setDraft({ ...draft, to: point });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const editPoint = pendingEdit.current;
    if (editPoint) {
      pendingEdit.current = null;
      void openTextForEditing(editPoint);
      return;
    }
    if (!draft) return;
    const point = toPagePoint(event);

    if (draft.kind === 'ink') {
      const points = draft.points.length > 1 ? draft.points : [...draft.points, point];
      const bounds = boundsOfPoints(points);
      const pad = settings.strokeWidth;
      const object: InkObject = {
        id: uid('ink'),
        kind: 'ink',
        strokes: [points],
        stroke: settings.color,
        strokeWidth: settings.strokeWidth,
        x: bounds.x - pad,
        y: bounds.y - pad,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2,
        rotation: 0,
      };
      setDraft(null);
      if (bounds.width + bounds.height > 2) commitObject(object, 'Draw');
      return;
    }

    const rect = rectFromPoints(draft.from, point);
    setDraft(null);

    if (draft.kind === 'marquee') {
      if (rect.width < 3 && rect.height < 3) return;
      const hits = page.objects.filter((object) => rectsIntersect(rect, object));
      store.getState().selectObjects(hits.map((o) => o.id));
      return;
    }

    const markup = MARKUP_TOOLS[tool];
    if (markup) {
      const items = pageText ? itemsInRect(pageText, rect) : [];
      const rects =
        items.length > 0
          ? items.map((item) => ({
              x: Math.max(item.rect.x, Math.min(rect.x, item.rect.x)),
              y: item.rect.y,
              width: item.rect.width,
              height: item.rect.height,
            }))
          : [rect];
      const bounds = boundsOfPoints(
        rects.flatMap((r) => [
          { x: r.x, y: r.y },
          { x: r.x + r.width, y: r.y + r.height },
        ]),
      );
      commitObject(
        {
          id: uid('markup'),
          kind: 'markup',
          markup,
          color: markup === 'highlight' ? settings.highlightColor : settings.color,
          rects,
          text: items.map((i) => i.str).join(' '),
          x: bounds.x,
          y: bounds.y,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
          rotation: 0,
        },
        markup === 'highlight' ? 'Highlight' : markup === 'underline' ? 'Underline' : 'Strikethrough',
      );
      return;
    }

    if (rect.width < 3 || rect.height < 3) {
      // A click with no drag: fall back to a sensible default size.
      rect.width = Math.max(rect.width, tool === 'text' ? 200 : 120);
      rect.height = Math.max(rect.height, tool === 'text' ? 40 : 60);
    }

    switch (tool) {
      case 'text': {
        const id = uid('text');
        commitObject(
          {
            id,
            kind: 'text',
            text: '',
            style: {
              size: settings.fontSize,
              color: settings.color,
              font: settings.fontFamily,
              bold: settings.bold,
              italic: settings.italic,
              align: 'left',
              lineHeight: 1.25,
            },
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: Math.max(rect.height, settings.fontSize * 1.6),
            rotation: 0,
          },
          'Add text box',
        );
        store.getState().setTool('select');
        store.getState().selectObjects([id]);
        store.getState().setEditingObject(id);
        break;
      }
      case 'shape':
        commitObject(
          {
            id: uid('shape'),
            kind: 'shape',
            shape: settings.shape,
            stroke: settings.color,
            strokeWidth: settings.strokeWidth,
            fill: settings.fillColor,
            from: { x: 0, y: 0 },
            to: { x: 1, y: 1 },
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            rotation: 0,
          },
          'Add shape',
        );
        break;
      case 'redact':
        commitObject(
          {
            id: uid('redact'),
            kind: 'redact',
            fill: '#000000',
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            rotation: 0,
          },
          'Mark for redaction',
        );
        break;
      case 'field':
        commitObject(
          {
            id: uid('field'),
            kind: 'field',
            field: settings.fieldKind,
            name: `${settings.fieldKind}_${Math.random().toString(36).slice(2, 6)}`,
            value: '',
            checked: false,
            options: settings.fieldKind === 'dropdown' ? ['Option 1', 'Option 2'] : undefined,
            fontSize: 11,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: settings.fieldKind === 'checkbox' ? Math.min(rect.height, 16) : Math.min(rect.height, 24),
            rotation: 0,
          },
          'Add form field',
        );
        break;
      case 'crop':
        store.getState().setCrop([pageIndex], rect);
        store.getState().setTool('select');
        break;
      default:
        break;
    }
  };

  const hitsOnPage = useMemo(
    () =>
      searchHits
        .map((hit, index) => ({ hit, index }))
        .filter((entry) => entry.hit.pageIndex === pageIndex),
    [searchHits, pageIndex],
  );

  const cursor =
    tool === 'select'
      ? 'default'
      : tool === 'pan'
        ? 'grab'
        : tool === 'edit-text'
          ? 'text'
          : 'crosshair';

  return (
    <div
      className={`page ${isCurrent ? 'page--current' : ''}`}
      style={{ width, height }}
      data-page-index={pageIndex}
      id={`page-${pageIndex}`}
    >
      <PageCanvas doc={doc} page={page} zoom={zoom} epoch={epoch} visible={visible} />

      <div
        className="page__overlay"
        ref={overlayRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverText(null)}
        role="presentation"
      >
        {hitsOnPage.map(({ hit, index }) =>
          hit.rects.map((rect, i) => (
            <span
              key={`${index}-${i}`}
              className={`search-hit ${index === activeHit ? 'search-hit--active' : ''}`}
              style={{
                left: (rect.x - view.x) * zoom,
                top: (rect.y - view.y) * zoom,
                width: rect.width * zoom,
                height: rect.height * zoom,
              }}
            />
          )),
        )}

        {hoverText && (
          <span
            className="text-hover"
            style={{
              left: (hoverText.x - view.x) * zoom,
              top: (hoverText.y - view.y) * zoom,
              width: hoverText.width * zoom,
              height: hoverText.height * zoom,
            }}
          />
        )}

        <div style={{ position: 'absolute', left: -view.x * zoom, top: -view.y * zoom }}>
          {page.objects.map((object) => (
            <ObjectView
              key={object.id}
              doc={doc}
              page={page}
              pageIndex={pageIndex}
              object={object}
              zoom={zoom}
              selected={selectedObjectIds.includes(object.id)}
              editing={editingObjectId === object.id}
              interactive={interactive}
              toPagePoint={toPagePoint}
            />
          ))}
        </div>

        {draft && draft.kind !== 'ink' && (
          <DraftRect from={draft.from} to={draft.to} zoom={zoom} view={view} marquee={draft.kind === 'marquee'} />
        )}
        {draft?.kind === 'ink' && (
          <svg
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            width={width}
            height={height}
          >
            <polyline
              points={draft.points.map((p) => `${(p.x - view.x) * zoom},${(p.y - view.y) * zoom}`).join(' ')}
              fill="none"
              stroke={settings.color}
              strokeWidth={settings.strokeWidth * zoom}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

function DraftRect({
  from,
  to,
  zoom,
  view,
  marquee,
}: {
  from: Point;
  to: Point;
  zoom: number;
  view: Rect;
  marquee: boolean;
}) {
  const rect = rectFromPoints(from, to);
  return (
    <div
      className={marquee ? 'marquee' : 'marquee'}
      style={{
        left: (rect.x - view.x) * zoom,
        top: (rect.y - view.y) * zoom,
        width: rect.width * zoom,
        height: rect.height * zoom,
      }}
    />
  );
}

interface TextLine {
  text: string;
  rect: Rect;
  fontSize: number;
  /** Display-space y of the line's baseline. */
  baseline: number;
  fontFamily?: string;
}

/**
 * The run of text under the pointer.
 *
 * Two things make this less obvious than it looks on real documents:
 *
 *  - Body text is often 8pt, so the glyph band is a thin target and more than
 *    half the space between baselines belongs to no item at all. A click that
 *    lands in the leading snaps to the nearest line instead of missing.
 *  - Sharing a baseline does not make two items one line. In a two-column
 *    statement or a table row, a label on the left and its value on the right
 *    sit on the same baseline but are separate runs; merging them would mangle
 *    both. Only horizontally adjacent items join up.
 */
function findTextLine(allItems: TextItem[], point: Point): TextLine | null {
  // PDFs frequently pad between columns with runs of spaces. Those carry no
  // glyphs, but left in they would bridge the gap and glue the columns back
  // together, so they are excluded from both hit-testing and merging — the
  // space they occupy then simply reads as the gap it is.
  const items = allItems.filter((item) => item.str.trim().length > 0);

  const contains = (item: TextItem) =>
    point.x >= item.rect.x - 2 &&
    point.x <= item.rect.x + item.rect.width + 2 &&
    point.y >= item.rect.y - 2 &&
    point.y <= item.rect.y + item.rect.height + 2;

  let hit = items.find(contains);

  if (!hit) {
    // Nearest line whose horizontal span covers the pointer, within a line or so.
    let bestDistance = Infinity;
    for (const item of items) {
      if (
        point.x < item.rect.x - item.fontSize ||
        point.x > item.rect.x + item.rect.width + item.fontSize
      ) {
        continue;
      }
      const top = item.rect.y;
      const bottom = top + item.rect.height;
      const distance = point.y < top ? top - point.y : point.y > bottom ? point.y - bottom : 0;
      if (distance < bestDistance && distance <= item.fontSize * 0.9) {
        bestDistance = distance;
        hit = item;
      }
    }
  }

  if (!hit) return null;
  const anchor = hit;

  const sameBaseline = items
    .filter((item) => Math.abs(item.baseline - anchor.baseline) < Math.max(1, anchor.fontSize * 0.3))
    .sort((a, b) => a.rect.x - b.rect.x);

  // Grow outwards from the clicked item while neighbours stay close enough to
  // be the same run. A column gap is many times wider than a word space.
  const maxGap = anchor.fontSize * 1.5;
  const start = sameBaseline.indexOf(anchor);
  const run: TextItem[] = [anchor];
  const gapBetween = (left: TextItem, right: TextItem) =>
    right.rect.x - (left.rect.x + left.rect.width);

  for (let i = start - 1; i >= 0; i -= 1) {
    if (gapBetween(sameBaseline[i], run[0]) > maxGap) break;
    run.unshift(sameBaseline[i]);
  }
  for (let i = start + 1; i < sameBaseline.length; i += 1) {
    if (gapBetween(run[run.length - 1], sameBaseline[i]) > maxGap) break;
    run.push(sameBaseline[i]);
  }

  let text = '';
  run.forEach((item, index) => {
    if (index > 0) {
      const gap = gapBetween(run[index - 1], item);
      const spaced = text.endsWith(' ') || item.str.startsWith(' ');
      if (gap > anchor.fontSize * 0.12 && !spaced) text += ' ';
    }
    text += item.str;
  });

  const bounds = boundsOfPoints(
    run.flatMap((item) => [
      { x: item.rect.x, y: item.rect.y },
      { x: item.rect.x + item.rect.width, y: item.rect.y + item.rect.height },
    ]),
  );

  return {
    text,
    rect: bounds,
    fontSize: anchor.fontSize,
    baseline: anchor.baseline,
    fontFamily: anchor.fontFamily,
  };
}

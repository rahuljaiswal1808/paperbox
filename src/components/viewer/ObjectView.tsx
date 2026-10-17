import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { EditorDocument, PageObject, PageState, Point } from '../../types/document';
import { useEditorStore } from '../../state/editorStore';
import { cssFontFamily } from '../../lib/pdf/fonts';
import { withAlpha } from '../../lib/util/color';

interface ObjectViewProps {
  doc: EditorDocument;
  page: PageState;
  pageIndex: number;
  object: PageObject;
  zoom: number;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  /** Converts a pointer event into display-space page coordinates. */
  toPagePoint: (event: { clientX: number; clientY: number }) => Point;
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

const HANDLES: { id: HandleId; x: number; y: number; cursor: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

const MIN_SIZE = 6;

export function ObjectView({
  doc,
  page,
  pageIndex,
  object,
  zoom,
  selected,
  editing,
  interactive,
  toPagePoint,
}: ObjectViewProps) {
  const store = useEditorStore;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** When edit mode opened, used to ignore the browser's own focus shuffle. */
  const editingSince = useRef(0);
  const gesture = useRef<{
    mode: 'move' | 'resize' | 'rotate';
    handle?: HandleId;
    start: Point;
    origin: { x: number; y: number; width: number; height: number; rotation: number };
  } | null>(null);

  useEffect(() => {
    if (!editing) return;
    editingSince.current = Date.now();
    // The browser assigns focus from the pointer event *after* React commits,
    // so claim it on the next frame or it lands on the scroll container.
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const beginGesture = (
    event: ReactPointerEvent,
    mode: 'move' | 'resize' | 'rotate',
    handle?: HandleId,
  ) => {
    if (!interactive || object.locked) return;
    event.stopPropagation();
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    store.getState().pushHistory(mode === 'move' ? 'Move object' : mode === 'rotate' ? 'Rotate object' : 'Resize object');
    gesture.current = {
      mode,
      handle,
      start: toPagePoint(event),
      origin: {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
      },
    };
    if (!selected) store.getState().selectObjects([object.id]);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = gesture.current;
    if (!state) return;
    const point = toPagePoint(event);
    const dx = point.x - state.start.x;
    const dy = point.y - state.start.y;
    const { origin } = state;

    if (state.mode === 'move') {
      store.getState().updateObject(object.id, { x: origin.x + dx, y: origin.y + dy });
      return;
    }

    if (state.mode === 'rotate') {
      const cx = origin.x + origin.width / 2;
      const cy = origin.y + origin.height / 2;
      const angle = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI + 90;
      const snapped = event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
      store.getState().updateObject(object.id, { rotation: snapped });
      return;
    }

    const handle = state.handle ?? 'se';
    let { x, y, width, height } = origin;
    if (handle.includes('e')) width = Math.max(MIN_SIZE, origin.width + dx);
    if (handle.includes('s')) height = Math.max(MIN_SIZE, origin.height + dy);
    if (handle.includes('w')) {
      width = Math.max(MIN_SIZE, origin.width - dx);
      x = origin.x + (origin.width - width);
    }
    if (handle.includes('n')) {
      height = Math.max(MIN_SIZE, origin.height - dy);
      y = origin.y + (origin.height - height);
    }
    if (event.shiftKey && object.kind === 'image') {
      const ratio = origin.width / origin.height;
      height = width / ratio;
      if (handle.includes('n')) y = origin.y + (origin.height - height);
    }
    store.getState().updateObject(object.id, { x, y, width, height });
  };

  const endGesture = (event: ReactPointerEvent) => {
    if (!gesture.current) return;
    gesture.current = null;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  const style: CSSProperties = {
    left: object.x * zoom,
    top: object.y * zoom,
    width: object.width * zoom,
    height: object.height * zoom,
    transform: object.rotation ? `rotate(${object.rotation}deg)` : undefined,
    opacity: object.opacity ?? 1,
    pointerEvents: interactive && !object.locked ? 'auto' : 'none',
  };

  return (
    <div
      className={`obj ${interactive ? 'obj--selectable' : ''} ${selected ? 'obj--selected' : ''}`}
      style={style}
      data-object-id={object.id}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? -1 : undefined}
      aria-label={describeObject(object)}
      onPointerDown={(event) => {
        if (editing) return;
        beginGesture(event, 'move');
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (object.kind === 'text' || object.kind === 'note') {
          store.getState().selectObjects([object.id]);
          store.getState().setEditingObject(object.id);
        }
      }}
    >
      <ObjectBody
        doc={doc}
        object={object}
        zoom={zoom}
        editing={editing}
        textareaRef={textareaRef}
        editingSince={editingSince}
        pageIndex={pageIndex}
        page={page}
      />

      {selected && interactive && !editing && (
        <>
          {HANDLES.map((handle) => (
            <span
              key={handle.id}
              className="handle"
              style={{
                left: `calc(${handle.x * 100}% - 4.5px)`,
                top: `calc(${handle.y * 100}% - 4.5px)`,
                cursor: handle.cursor,
              }}
              onPointerDown={(event) => beginGesture(event, 'resize', handle.id)}
              onPointerMove={onPointerMove}
              onPointerUp={endGesture}
            />
          ))}
          {object.kind !== 'markup' && object.kind !== 'field' && (
            <span
              className="handle handle--rotate"
              style={{ left: 'calc(50% - 4.5px)', top: -18 }}
              title="Rotate"
              onPointerDown={(event) => beginGesture(event, 'rotate')}
              onPointerMove={onPointerMove}
              onPointerUp={endGesture}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Ascent/descent of the CSS stand-ins for the three standard font families. */
const FONT_METRICS: Record<string, { ascent: number; descent: number }> = {
  Helvetica: { ascent: 0.905, descent: 0.212 },
  Times: { ascent: 0.891, descent: 0.216 },
  Courier: { ascent: 0.833, descent: 0.3 },
};

/**
 * Top padding that drops the DOM text's first baseline onto `baselineOffset`,
 * so what the user types lines up with what the exporter will write.
 */
function domBaselinePadding(object: Extract<PageObject, { kind: 'text' }>, zoom: number): number {
  if (object.baselineOffset === undefined) return 0;
  const { size, lineHeight } = object.style;
  const metrics = FONT_METRICS[object.style.font] ?? FONT_METRICS.Helvetica;
  const cssBaseline =
    (size * lineHeight - size * (metrics.ascent + metrics.descent)) / 2 + size * metrics.ascent;
  return Math.max(0, (object.baselineOffset - cssBaseline) * zoom);
}

function describeObject(object: PageObject): string {
  switch (object.kind) {
    case 'text':
      return `Text box: ${object.text.slice(0, 40)}`;
    case 'note':
      return `Sticky note: ${object.text.slice(0, 40)}`;
    case 'image':
      return object.isSignature ? 'Signature' : 'Image';
    case 'shape':
      return `${object.shape} shape`;
    case 'ink':
      return 'Freehand drawing';
    case 'markup':
      return `${object.markup} markup`;
    case 'redact':
      return 'Redaction area';
    case 'field':
      return `${object.field} field ${object.name}`;
    default:
      return 'Object';
  }
}

interface ObjectBodyProps {
  doc: EditorDocument;
  page: PageState;
  pageIndex: number;
  object: PageObject;
  zoom: number;
  editing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  editingSince: React.RefObject<number>;
}

function ObjectBody({ doc, object, zoom, editing, textareaRef, editingSince }: ObjectBodyProps) {
  const updateObject = useEditorStore((state) => state.updateObject);
  const setEditingObject = useEditorStore((state) => state.setEditingObject);

  switch (object.kind) {
    case 'text': {
      const style = object.style;
      const shared: CSSProperties = {
        fontFamily: cssFontFamily(style.font),
        fontSize: style.size * zoom,
        lineHeight: `${style.size * style.lineHeight * zoom}px`,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        color: style.color,
        textAlign: style.align,
        background: object.background ?? 'transparent',
        paddingTop: domBaselinePadding(object, zoom),
      };
      if (editing) {
        return (
          <textarea
            ref={textareaRef}
            className="obj__textarea"
            style={shared}
            value={object.text}
            aria-label="Edit text"
            onChange={(event) => updateObject(object.id, { text: event.target.value })}
            onFocus={() => useEditorStore.getState().pushHistory('Edit text')}
            onBlur={(event) => {
              // A blur with no incoming element, right after opening, is the
              // browser moving focus to the scroll container — not the user
              // leaving the field. Take focus back instead of closing.
              if (!event.relatedTarget && Date.now() - editingSince.current < 600) {
                requestAnimationFrame(() => textareaRef.current?.focus());
                return;
              }
              setEditingObject(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setEditingObject(null);
              }
              event.stopPropagation();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        );
      }
      return (
        <div className="obj__text" style={shared}>
          {object.text || <span style={{ opacity: 0.35 }}>Text</span>}
        </div>
      );
    }
    case 'image': {
      const asset = doc.assets[object.assetId];
      if (!asset) return <div className="obj__field">Missing image</div>;
      return <ImageBody asset={asset} />;
    }
    case 'shape':
      return <ShapeBody object={object} zoom={zoom} />;
    case 'ink':
      return <InkBody object={object} zoom={zoom} />;
    case 'markup':
      return <MarkupBody object={object} zoom={zoom} />;
    case 'note':
      return editing ? (
        <textarea
          ref={textareaRef}
          className="obj__textarea"
          style={{ background: object.color, fontSize: Math.max(8, 9 * zoom), color: '#1f2937' }}
          value={object.text}
          aria-label="Edit note"
          onChange={(event) => updateObject(object.id, { text: event.target.value })}
          onBlur={() => setEditingObject(null)}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : (
        <div className="obj__note" style={{ background: object.color, width: '100%', height: '100%' }} title={object.text}>
          <span style={{ fontSize: Math.max(7, 8 * zoom) }}>note</span>
        </div>
      );
    case 'redact':
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: object.fill,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontSize: Math.max(7, 8 * zoom),
          }}
        >
          {object.overlayText}
        </div>
      );
    case 'field':
      return (
        <div className="obj__field" style={{ width: '100%', height: '100%', fontSize: Math.max(7, (object.fontSize ?? 11) * zoom) }}>
          {object.field === 'checkbox' ? (
            <span style={{ margin: 'auto' }}>{object.checked ? '✓' : ''}</span>
          ) : (
            <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {object.value || <span style={{ opacity: 0.5 }}>{object.name}</span>}
            </span>
          )}
        </div>
      );
    default:
      return null;
  }
}

function ImageBody({ asset }: { asset: { bytes: Uint8Array; type: string } }) {
  const url = useObjectUrl(asset.bytes, asset.type);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
    />
  );
}

function useObjectUrl(bytes: Uint8Array, type: string): string | null {
  const ref = useRef<{ url: string; bytes: Uint8Array } | null>(null);
  if (!ref.current || ref.current.bytes !== bytes) {
    if (ref.current) URL.revokeObjectURL(ref.current.url);
    ref.current = {
      bytes,
      url: URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type })),
    };
  }
  useEffect(() => () => {
    if (ref.current) URL.revokeObjectURL(ref.current.url);
    ref.current = null;
  }, []);
  return ref.current.url;
}

function ShapeBody({ object, zoom }: { object: Extract<PageObject, { kind: 'shape' }>; zoom: number }) {
  const w = Math.max(1, object.width * zoom);
  const h = Math.max(1, object.height * zoom);
  const stroke = object.strokeWidth * zoom;
  const half = stroke / 2;

  if (object.shape === 'rectangle') {
    return (
      <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
        <rect
          x={half}
          y={half}
          width={Math.max(0, w - stroke)}
          height={Math.max(0, h - stroke)}
          fill={object.fill ?? 'none'}
          stroke={object.stroke}
          strokeWidth={stroke}
        />
      </svg>
    );
  }
  if (object.shape === 'ellipse') {
    return (
      <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0, w / 2 - half)}
          ry={Math.max(0, h / 2 - half)}
          fill={object.fill ?? 'none'}
          stroke={object.stroke}
          strokeWidth={stroke}
        />
      </svg>
    );
  }

  const from = object.from ?? { x: 0, y: 0.5 };
  const to = object.to ?? { x: 1, y: 0.5 };
  const ax = from.x * w;
  const ay = from.y * h;
  const bx = to.x * w;
  const by = to.y * h;
  const angle = Math.atan2(by - ay, bx - ax);
  const head = Math.max(6, object.strokeWidth * 3.5) * zoom;

  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={object.stroke} strokeWidth={stroke} strokeLinecap="round" />
      {object.shape === 'arrow' &&
        [Math.PI * 0.82, -Math.PI * 0.82].map((spread, i) => (
          <line
            key={i}
            x1={bx}
            y1={by}
            x2={bx + Math.cos(angle + spread) * head}
            y2={by + Math.sin(angle + spread) * head}
            stroke={object.stroke}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ))}
    </svg>
  );
}

function InkBody({ object, zoom }: { object: Extract<PageObject, { kind: 'ink' }>; zoom: number }) {
  const w = Math.max(1, object.width * zoom);
  const h = Math.max(1, object.height * zoom);
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {object.strokes.map((stroke, index) => (
        <polyline
          key={index}
          points={stroke
            .map((point) => `${(point.x - object.x) * zoom},${(point.y - object.y) * zoom}`)
            .join(' ')}
          fill="none"
          stroke={object.stroke}
          strokeWidth={object.strokeWidth * zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function MarkupBody({ object, zoom }: { object: Extract<PageObject, { kind: 'markup' }>; zoom: number }) {
  return (
    <>
      {object.rects.map((rect, index) => {
        const left = (rect.x - object.x) * zoom;
        const top = (rect.y - object.y) * zoom;
        const width = rect.width * zoom;
        const height = rect.height * zoom;
        if (object.markup === 'highlight') {
          return (
            <span
              key={index}
              style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                background: withAlpha(object.color, 0.35),
                mixBlendMode: 'multiply',
              }}
            />
          );
        }
        const thickness = Math.max(1, height * 0.06 * zoom);
        return (
          <span
            key={index}
            style={{
              position: 'absolute',
              left,
              top: top + (object.markup === 'underline' ? height * 0.94 : height * 0.55),
              width,
              height: thickness,
              background: object.color,
            }}
          />
        );
      })}
    </>
  );
}

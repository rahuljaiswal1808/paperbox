import { useEffect, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useUiStore } from '../../state/uiStore';
import { Button, Checkbox, Field, Modal, Note, TextInput } from '../ui/controls';
import { Icon } from '../ui/Icon';
import type { Bookmark } from '../../types/document';
import { formatBytes, formatDate, uid } from '../../lib/util/misc';
import { headerFooterObjects, watermarkObject, type HeaderFooterOptions, type WatermarkOptions } from '../../lib/ops/decorate';
import { createImageAsset } from '../../lib/ops/assets';
import { pickFiles } from '../../lib/util/file';
import { countPagesWithoutText } from '../../lib/ops/convert';

export function MetadataDialog() {
  const doc = useEditorStore((state) => state.doc);
  const setMetadata = useEditorStore((state) => state.setMetadata);
  const close = useUiStore((state) => state.closeDialog);
  if (!doc) return null;

  const meta = doc.metadata;
  const sourceBytes = Object.values(doc.sources).reduce((total, source) => total + source.bytes.byteLength, 0);

  return (
    <Modal
      title="Document properties"
      icon="info"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <Field label="Title">
        {(id) => <TextInput id={id} value={meta.title} onChange={(event) => setMetadata({ title: event.target.value })} />}
      </Field>
      <div className="field-row">
        <Field label="Author">
          {(id) => <TextInput id={id} value={meta.author} onChange={(event) => setMetadata({ author: event.target.value })} />}
        </Field>
        <Field label="Subject">
          {(id) => <TextInput id={id} value={meta.subject} onChange={(event) => setMetadata({ subject: event.target.value })} />}
        </Field>
      </div>
      <Field label="Keywords" hint="Separate with commas.">
        {(id) => <TextInput id={id} value={meta.keywords} onChange={(event) => setMetadata({ keywords: event.target.value })} />}
      </Field>
      <div className="field-row">
        <Field label="Creator">
          {(id) => <TextInput id={id} value={meta.creator} onChange={(event) => setMetadata({ creator: event.target.value })} />}
        </Field>
        <Field label="Producer">
          {(id) => <TextInput id={id} value={meta.producer} onChange={(event) => setMetadata({ producer: event.target.value })} />}
        </Field>
      </div>

      <div className="panel__title" style={{ marginTop: 10 }}>
        Read-only
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0 }}>
        <dt className="muted small">Pages</dt>
        <dd className="small" style={{ margin: 0 }}>{doc.pages.length}</dd>
        <dt className="muted small">Source files</dt>
        <dd className="small" style={{ margin: 0 }}>
          {Object.values(doc.sources).map((source) => source.name).join(', ') || 'None (built here)'}
        </dd>
        <dt className="muted small">Bytes held in memory</dt>
        <dd className="small" style={{ margin: 0 }}>{formatBytes(sourceBytes)}</dd>
        <dt className="muted small">Created</dt>
        <dd className="small" style={{ margin: 0 }}>{formatDate(meta.creationDate)}</dd>
        <dt className="muted small">Last modified</dt>
        <dd className="small" style={{ margin: 0 }}>{formatDate(doc.updatedAt)}</dd>
      </dl>
    </Modal>
  );
}

export function BookmarksDialog() {
  const doc = useEditorStore((state) => state.doc);
  const setBookmarks = useEditorStore((state) => state.setBookmarks);
  const close = useUiStore((state) => state.closeDialog);
  const [title, setTitle] = useState('');
  const [page, setPage] = useState(1);
  if (!doc) return null;

  const flat = (items: Bookmark[], depth = 0): { bookmark: Bookmark; depth: number }[] =>
    items.flatMap((bookmark) => [{ bookmark, depth }, ...flat(bookmark.children, depth + 1)]);

  const remove = (id: string) => {
    const strip = (list: Bookmark[]): Bookmark[] =>
      list.filter((b) => b.id !== id).map((b) => ({ ...b, children: strip(b.children) }));
    setBookmarks(strip(doc.bookmarks));
  };

  const rename = (id: string, next: string) => {
    const walk = (list: Bookmark[]): Bookmark[] =>
      list.map((b) => (b.id === id ? { ...b, title: next } : { ...b, children: walk(b.children) }));
    setBookmarks(walk(doc.bookmarks));
  };

  return (
    <Modal
      title="Bookmarks"
      icon="bookmark"
      onClose={close}
      description="Bookmarks become the PDF's outline, shown in the reader's navigation pane."
      footer={
        <>
          <span className="spacer" />
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <Field label="Title">
          {(id) => <TextInput id={id} value={title} onChange={(event) => setTitle(event.target.value)} />}
        </Field>
        <Field label="Page">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={doc.pages.length}
              style={{ width: 80 }}
              value={page}
              onChange={(event) => setPage(Number(event.target.value))}
            />
          )}
        </Field>
        <Button
          icon="plus"
          variant="outline"
          disabled={!title.trim()}
          onClick={() => {
            setBookmarks(
              [...doc.bookmarks, { id: uid('bm'), title, pageIndex: Math.max(0, page - 1), children: [] }].sort(
                (a, b) => a.pageIndex - b.pageIndex,
              ),
            );
            setTitle('');
          }}
        >
          Add
        </Button>
      </div>

      <div className="file-list" style={{ marginTop: 12 }}>
        {flat(doc.bookmarks).map(({ bookmark, depth }) => (
          <div className="file-row" key={bookmark.id} style={{ marginLeft: depth * 16 }}>
            <Icon name="bookmark" size={14} />
            <TextInput
              value={bookmark.title}
              aria-label="Bookmark title"
              onChange={(event) => rename(bookmark.id, event.target.value)}
            />
            <span className="file-row__meta">p{bookmark.pageIndex + 1}</span>
            <Button icon="trash" iconOnly size="sm" aria-label="Delete" onClick={() => remove(bookmark.id)} />
          </div>
        ))}
        {doc.bookmarks.length === 0 && <div className="empty">No bookmarks yet.</div>}
      </div>
    </Modal>
  );
}

export function WatermarkDialog() {
  const doc = useEditorStore((state) => state.doc);
  const close = useUiStore((state) => state.closeDialog);
  const addAsset = useEditorStore((state) => state.addAsset);
  const [kind, setKind] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState(52);
  const [colour, setColour] = useState('#ef4444');
  const [opacity, setOpacity] = useState(0.18);
  const [rotation, setRotation] = useState(-35);
  const [scale, setScale] = useState(0.8);
  const [image, setImage] = useState<{ id: string; aspect: number; name: string } | null>(null);
  const [onlySelected, setOnlySelected] = useState(false);
  const selected = useEditorStore((state) => state.selectedPageIndexes);

  if (!doc) return null;

  const apply = () => {
    const options: WatermarkOptions =
      kind === 'image' && image
        ? { kind: 'image', assetId: image.id, aspect: image.aspect, opacity, rotation, scale }
        : { kind: 'text', text, fontSize, color: colour, opacity, rotation, scale };

    useEditorStore.getState().update(
      (current) => ({
        ...current,
        pages: current.pages.map((page, index) =>
          onlySelected && selected.length > 0 && !selected.includes(index)
            ? page
            : { ...page, objects: [...page.objects, watermarkObject(page, options)] },
        ),
      }),
      'Add watermark',
    );
    close();
  };

  const chooseImage = async () => {
    const [file] = await pickFiles('image/*', false);
    if (!file) return;
    const asset = await createImageAsset(file);
    addAsset(asset);
    setImage({ id: asset.id, aspect: asset.width / asset.height, name: file.name });
    setKind('image');
  };

  return (
    <Modal
      title="Watermark"
      icon="image"
      onClose={close}
      description="Watermarks are added as ordinary objects — you can move, restyle or undo them afterwards."
      footer={
        <>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={apply} disabled={kind === 'image' && !image}>
            Apply to {onlySelected && selected.length > 0 ? `${selected.length} page(s)` : `all ${doc.pages.length} pages`}
          </Button>
        </>
      }
    >
      <div className="chips" style={{ marginBottom: 12 }}>
        <button type="button" className={`chip ${kind === 'text' ? 'chip--active' : ''}`} onClick={() => setKind('text')}>
          Text
        </button>
        <button type="button" className={`chip ${kind === 'image' ? 'chip--active' : ''}`} onClick={() => void chooseImage()}>
          {image ? `Image · ${image.name}` : 'Image…'}
        </button>
      </div>

      {kind === 'text' && (
        <>
          <Field label="Text">
            {(id) => <TextInput id={id} value={text} onChange={(event) => setText(event.target.value)} />}
          </Field>
          <div className="field-row">
            <Field label="Size">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                />
              )}
            </Field>
            <Field label="Colour">
              {(id) => (
                <input
                  id={id}
                  type="color"
                  className="color-input"
                  value={colour}
                  onChange={(event) => setColour(event.target.value)}
                />
              )}
            </Field>
          </div>
        </>
      )}

      <Field label={`Opacity · ${Math.round(opacity * 100)}%`}>
        {(id) => (
          <input
            id={id}
            className="range"
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
        )}
      </Field>
      <Field label={`Rotation · ${rotation}°`}>
        {(id) => (
          <input
            id={id}
            className="range"
            type="range"
            min={-90}
            max={90}
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value))}
          />
        )}
      </Field>
      <Field label={`Width · ${Math.round(scale * 100)}% of the page`}>
        {(id) => (
          <input
            id={id}
            className="range"
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
          />
        )}
      </Field>

      <Checkbox
        checked={onlySelected}
        onChange={setOnlySelected}
        label={`Only the ${selected.length} selected page(s)`}
        disabled={selected.length === 0}
      />
    </Modal>
  );
}

export function HeaderFooterDialog() {
  const doc = useEditorStore((state) => state.doc);
  const close = useUiStore((state) => state.closeDialog);
  const [options, setOptions] = useState<HeaderFooterOptions>({
    placement: 'footer',
    slots: { left: '', centre: 'Page {page} of {pages}', right: '' },
    fontSize: 9,
    color: '#4b5563',
    margin: 28,
    startNumber: 1,
    skipFirst: 0,
  });

  if (!doc) return null;

  const apply = () => {
    useEditorStore.getState().update(
      (current) => ({
        ...current,
        pages: current.pages.map((page, index) => ({
          ...page,
          objects: [...page.objects, ...headerFooterObjects(current, page, index, options)],
        })),
      }),
      options.placement === 'header' ? 'Add header' : 'Add footer',
    );
    close();
  };

  const patch = (next: Partial<HeaderFooterOptions>) => setOptions((current) => ({ ...current, ...next }));

  return (
    <Modal
      title="Header, footer & page numbers"
      icon="text"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={apply}>
            Apply to {doc.pages.length} pages
          </Button>
        </>
      }
    >
      <div className="chips" style={{ marginBottom: 12 }}>
        {(['header', 'footer'] as const).map((placement) => (
          <button
            key={placement}
            type="button"
            className={`chip ${options.placement === placement ? 'chip--active' : ''}`}
            onClick={() => patch({ placement })}
          >
            {placement === 'header' ? 'Header (top)' : 'Footer (bottom)'}
          </button>
        ))}
      </div>

      <div className="field-row">
        <Field label="Left">
          {(id) => (
            <TextInput
              id={id}
              value={options.slots.left}
              onChange={(event) => patch({ slots: { ...options.slots, left: event.target.value } })}
            />
          )}
        </Field>
        <Field label="Centre">
          {(id) => (
            <TextInput
              id={id}
              value={options.slots.centre}
              onChange={(event) => patch({ slots: { ...options.slots, centre: event.target.value } })}
            />
          )}
        </Field>
        <Field label="Right">
          {(id) => (
            <TextInput
              id={id}
              value={options.slots.right}
              onChange={(event) => patch({ slots: { ...options.slots, right: event.target.value } })}
            />
          )}
        </Field>
      </div>

      <Note kind="info">
        Tokens: <code className="mono">{'{page}'}</code> <code className="mono">{'{pages}'}</code>{' '}
        <code className="mono">{'{n}'}</code> (starts at your first number){' '}
        <code className="mono">{'{title}'}</code> <code className="mono">{'{date}'}</code>{' '}
        <code className="mono">{'{time}'}</code>
      </Note>

      <div className="field-row">
        <Field label="Font size">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              value={options.fontSize}
              onChange={(event) => patch({ fontSize: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label="Margin">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              value={options.margin}
              onChange={(event) => patch({ margin: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label="Colour">
          {(id) => (
            <input
              id={id}
              type="color"
              className="color-input"
              value={options.color}
              onChange={(event) => patch({ color: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="field-row">
        <Field label="First number">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              value={options.startNumber}
              onChange={(event) => patch({ startNumber: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label="Skip first N pages">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={0}
              value={options.skipFirst}
              onChange={(event) => patch({ skipFirst: Number(event.target.value) })}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

export function OcrDialog() {
  const close = useUiStore((state) => state.closeDialog);
  const doc = useEditorStore((state) => state.doc);
  const [scanned, setScanned] = useState<number | null>(null);

  useEffect(() => {
    if (!doc) return;
    let active = true;
    countPagesWithoutText(doc)
      .then((count) => active && setScanned(count))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [doc]);

  return (
    <Modal
      title="OCR — make scanned pages searchable"
      icon="search"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        </>
      }
    >
      {scanned !== null && (
        <Note kind={scanned > 0 ? 'warning' : 'info'}>
          {scanned > 0
            ? `${scanned} of ${doc?.pages.length} pages have no text layer, so their words cannot be searched or copied yet.`
            : 'Every page in this document already has a text layer — search and copy work without OCR.'}
        </Note>
      )}
      <Note kind="warning">No OCR engine is installed in this build.</Note>
      <p>
        Recognition engines ship tens of megabytes of language data, which would slow the first load
        for everyone — including the many people who never open a scan. Paperbox therefore keeps OCR
        as a pluggable engine rather than bundling one.
      </p>
      <p className="small muted">
        The extension point lives in <code className="mono">src/lib/ops/ocr.ts</code>. Register an
        engine before the app mounts and this dialog turns into a working page-by-page OCR run:
      </p>
      <pre
        className="mono"
        style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, overflowX: 'auto' }}
      >{`window.paperboxRegisterOcrEngine({
  id: 'tesseract',
  languages: [{ code: 'eng', label: 'English' }],
  async recognize(image, { language, onProgress }) {
    // return { text, words: [{ text, x, y, width, height, confidence }] }
  },
});`}</pre>
      <p className="small muted">
        The word-level result shape exists so a future engine can write a real invisible text layer
        behind the page image, keeping the scan's appearance while making it searchable and
        selectable. English first, other languages by adding them to the engine's list.
      </p>
      <p className="small muted">
        In the meantime, <strong>PDF → text</strong> extracts any text a PDF already contains.
      </p>
    </Modal>
  );
}

import { findObject, useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import type { PageObject, TextAlign } from '../types/document';
import { Button, Checkbox, Field, Select, TextArea, TextInput } from './ui/controls';
import { Icon } from './ui/Icon';
import { FONT_FAMILIES } from '../lib/pdf/fonts';
import { formatBytes, formatPageList } from '../lib/util/misc';

const round = (value: number) => Math.round(value * 10) / 10;

export function PropertiesPanel() {
  const doc = useEditorStore((state) => state.doc);
  const selectedIds = useEditorStore((state) => state.selectedObjectIds);
  const selection = findObject(doc, selectedIds[0] ?? null);

  if (!doc) return null;

  return (
    <aside className="panel" aria-label="Properties">
      {selection ? (
        <ObjectProperties object={selection.object} />
      ) : (
        <PageProperties />
      )}
    </aside>
  );
}

function ObjectProperties({ object }: { object: PageObject }) {
  const updateObject = useEditorStore((state) => state.updateObject);
  const removeObjects = useEditorStore((state) => state.removeObjects);
  const bringForward = useEditorStore((state) => state.bringForward);

  const patchGeometry = (patch: Partial<PageObject>) =>
    updateObject(object.id, patch, 'Change properties');

  return (
    <>
      <div className="panel__section">
        <div className="panel__title">{describeKind(object)}</div>
        <div className="field-row">
          <Field label="X">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                value={round(object.x)}
                onChange={(event) => patchGeometry({ x: Number(event.target.value) })}
              />
            )}
          </Field>
          <Field label="Y">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                value={round(object.y)}
                onChange={(event) => patchGeometry({ y: Number(event.target.value) })}
              />
            )}
          </Field>
        </div>
        <div className="field-row">
          <Field label="Width">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                value={round(object.width)}
                onChange={(event) => patchGeometry({ width: Math.max(1, Number(event.target.value)) })}
              />
            )}
          </Field>
          <Field label="Height">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                value={round(object.height)}
                onChange={(event) => patchGeometry({ height: Math.max(1, Number(event.target.value)) })}
              />
            )}
          </Field>
        </div>
        <Field label={`Rotation · ${object.rotation}°`}>
          {(id) => (
            <input
              id={id}
              className="range"
              type="range"
              min={-180}
              max={180}
              value={object.rotation}
              onChange={(event) => patchGeometry({ rotation: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label={`Opacity · ${Math.round((object.opacity ?? 1) * 100)}%`}>
          {(id) => (
            <input
              id={id}
              className="range"
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={object.opacity ?? 1}
              onChange={(event) => patchGeometry({ opacity: Number(event.target.value) })}
            />
          )}
        </Field>
        <Checkbox
          checked={Boolean(object.locked)}
          onChange={(value) => patchGeometry({ locked: value })}
          label="Lock position"
        />
      </div>

      {object.kind === 'text' && (
        <div className="panel__section">
          <div className="panel__title">Text</div>
          <Field label="Content">
            {(id) => (
              <TextArea
                id={id}
                value={object.text}
                onChange={(event) => updateObject(object.id, { text: event.target.value })}
              />
            )}
          </Field>
          <div className="field-row">
            <Field label="Font">
              {(id) => (
                <Select
                  id={id}
                  value={object.style.font}
                  onChange={(event) =>
                    updateObject(object.id, {
                      style: { ...object.style, font: event.target.value as typeof object.style.font },
                    })
                  }
                >
                  {FONT_FAMILIES.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Size">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={4}
                  value={object.style.size}
                  onChange={(event) =>
                    updateObject(object.id, {
                      style: { ...object.style, size: Math.max(4, Number(event.target.value)) },
                    })
                  }
                />
              )}
            </Field>
          </div>
          <div className="row">
            <Field label="Colour">
              {(id) => (
                <input
                  id={id}
                  type="color"
                  className="color-input"
                  value={object.style.color}
                  onChange={(event) =>
                    updateObject(object.id, { style: { ...object.style, color: event.target.value } })
                  }
                />
              )}
            </Field>
            <Field label="Align">
              {(id) => (
                <Select
                  id={id}
                  value={object.style.align}
                  onChange={(event) =>
                    updateObject(object.id, {
                      style: { ...object.style, align: event.target.value as TextAlign },
                    })
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="row">
            <Button
              size="sm"
              active={object.style.bold}
              onClick={() => updateObject(object.id, { style: { ...object.style, bold: !object.style.bold } })}
            >
              <strong>B</strong>
            </Button>
            <Button
              size="sm"
              active={object.style.italic}
              onClick={() => updateObject(object.id, { style: { ...object.style, italic: !object.style.italic } })}
            >
              <em>I</em>
            </Button>
            <Checkbox
              checked={Boolean(object.background)}
              onChange={(value) => updateObject(object.id, { background: value ? '#ffffff' : undefined })}
              label="Opaque background"
            />
          </div>
          {object.replacesSourceText && (
            <p className="small muted">
              This box covers text from the original file. The original characters are still in the
              PDF underneath — use <strong>Redact</strong> if they must be removed.
            </p>
          )}
        </div>
      )}

      {(object.kind === 'shape' || object.kind === 'ink') && (
        <div className="panel__section">
          <div className="panel__title">Stroke</div>
          <div className="row">
            <input
              type="color"
              className="color-input"
              aria-label="Stroke colour"
              value={object.stroke}
              onChange={(event) => updateObject(object.id, { stroke: event.target.value })}
            />
            <input
              className="range"
              type="range"
              min={0.5}
              max={16}
              step={0.5}
              aria-label="Stroke width"
              value={object.strokeWidth}
              onChange={(event) => updateObject(object.id, { strokeWidth: Number(event.target.value) })}
            />
            <span className="small muted">{object.strokeWidth}pt</span>
          </div>
          {object.kind === 'shape' && (
            <Checkbox
              checked={object.fill !== null}
              onChange={(value) => updateObject(object.id, { fill: value ? '#ffffff' : null })}
              label="Filled"
            />
          )}
          {object.kind === 'shape' && object.fill !== null && (
            <input
              type="color"
              className="color-input"
              aria-label="Fill colour"
              value={object.fill}
              onChange={(event) => updateObject(object.id, { fill: event.target.value })}
            />
          )}
        </div>
      )}

      {object.kind === 'markup' && (
        <div className="panel__section">
          <div className="panel__title">Markup</div>
          <input
            type="color"
            className="color-input"
            aria-label="Markup colour"
            value={object.color}
            onChange={(event) => updateObject(object.id, { color: event.target.value })}
          />
          {object.text && <p className="small muted">“{object.text.slice(0, 160)}”</p>}
        </div>
      )}

      {object.kind === 'note' && (
        <div className="panel__section">
          <div className="panel__title">Note</div>
          <Field label="Text">
            {(id) => (
              <TextArea
                id={id}
                value={object.text}
                onChange={(event) => updateObject(object.id, { text: event.target.value })}
              />
            )}
          </Field>
        </div>
      )}

      {object.kind === 'redact' && (
        <div className="panel__section">
          <div className="panel__title">Redaction</div>
          <p className="small muted">
            On export this page is rebuilt from rendered pixels with the area painted over, so the
            text and images underneath cannot be recovered from the file.
          </p>
          <Field label="Overlay label (optional)">
            {(id) => (
              <TextInput
                id={id}
                value={object.overlayText ?? ''}
                placeholder="e.g. REDACTED"
                onChange={(event) => updateObject(object.id, { overlayText: event.target.value })}
              />
            )}
          </Field>
        </div>
      )}

      {object.kind === 'field' && (
        <div className="panel__section">
          <div className="panel__title">Form field</div>
          <Field label="Field name">
            {(id) => (
              <TextInput
                id={id}
                value={object.name}
                onChange={(event) => updateObject(object.id, { name: event.target.value })}
              />
            )}
          </Field>
          {object.field === 'checkbox' ? (
            <Checkbox
              checked={Boolean(object.checked)}
              onChange={(value) => updateObject(object.id, { checked: value })}
              label="Checked"
            />
          ) : (
            <Field label="Value">
              {(id) => (
                <TextInput
                  id={id}
                  value={object.value}
                  onChange={(event) => updateObject(object.id, { value: event.target.value })}
                />
              )}
            </Field>
          )}
          {object.field === 'dropdown' && (
            <Field label="Options (one per line)">
              {(id) => (
                <TextArea
                  id={id}
                  value={(object.options ?? []).join('\n')}
                  onChange={(event) =>
                    updateObject(object.id, { options: event.target.value.split('\n').filter(Boolean) })
                  }
                />
              )}
            </Field>
          )}
          {object.sourceField && (
            <p className="small muted">
              This field comes from the original PDF. Filled values are written into the page on
              export.
            </p>
          )}
        </div>
      )}

      <div className="panel__section">
        <div className="row">
          <Button icon="arrow-up" size="sm" onClick={() => bringForward(object.id, 1)}>
            Forward
          </Button>
          <Button icon="arrow-down" size="sm" onClick={() => bringForward(object.id, -1)}>
            Backward
          </Button>
        </div>
        <Button
          icon="trash"
          variant="danger"
          size="sm"
          block
          style={{ marginTop: 8 }}
          onClick={() => removeObjects([object.id])}
        >
          Delete object
        </Button>
      </div>
    </>
  );
}

function PageProperties() {
  const doc = useEditorStore((state) => state.doc);
  const currentPage = useEditorStore((state) => state.currentPage);
  const selectedPages = useEditorStore((state) => state.selectedPageIndexes);
  const rotatePages = useEditorStore((state) => state.rotatePages);
  const setCrop = useEditorStore((state) => state.setCrop);
  const openDialog = useUiStore((state) => state.openDialog);

  const page = doc?.pages[currentPage];
  if (!doc || !page) return null;

  const targets = selectedPages.length > 0 ? selectedPages : [currentPage];
  const sourceBytes = Object.values(doc.sources).reduce((total, source) => total + source.bytes.byteLength, 0);

  return (
    <>
      <div className="panel__section">
        <div className="panel__title">Page {currentPage + 1}</div>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px' }}>
          <dt className="muted small">Size</dt>
          <dd className="small" style={{ margin: 0 }}>
            {round(page.width)} × {round(page.height)} pt
          </dd>
          <dt className="muted small">Rotation</dt>
          <dd className="small" style={{ margin: 0 }}>
            {page.rotation}°
          </dd>
          <dt className="muted small">Objects</dt>
          <dd className="small" style={{ margin: 0 }}>
            {page.objects.length}
          </dd>
          <dt className="muted small">Cropped</dt>
          <dd className="small" style={{ margin: 0 }}>
            {page.crop ? 'Yes' : 'No'}
          </dd>
        </dl>
        <div className="row" style={{ marginTop: 10 }}>
          <Button icon="rotate-ccw" iconOnly aria-label="Rotate left" onClick={() => rotatePages(targets, 270)} />
          <Button icon="rotate-cw" iconOnly aria-label="Rotate right" onClick={() => rotatePages(targets, 90)} />
          <Button icon="crop" size="sm" onClick={() => useEditorStore.getState().setTool('crop')}>
            Crop
          </Button>
          {page.crop && (
            <Button size="sm" onClick={() => setCrop(targets, undefined)}>
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="panel__section">
        <div className="panel__title">Selection</div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {selectedPages.length > 1
            ? `Pages ${formatPageList(selectedPages)}`
            : 'Shift-click or ⌘-click thumbnails to select several pages.'}
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <Button size="sm" icon="copy" onClick={() => useEditorStore.getState().duplicatePages(targets)}>
            Duplicate
          </Button>
          <Button size="sm" icon="split" onClick={() => openDialog('split')}>
            Split
          </Button>
          <Button
            size="sm"
            icon="trash"
            variant="danger"
            onClick={() => useEditorStore.getState().deletePages(targets)}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="panel__section">
        <div className="panel__title">Document</div>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px' }}>
          <dt className="muted small">Pages</dt>
          <dd className="small" style={{ margin: 0 }}>
            {doc.pages.length}
          </dd>
          <dt className="muted small">Sources</dt>
          <dd className="small" style={{ margin: 0 }}>
            {Object.keys(doc.sources).length} file(s), {formatBytes(sourceBytes)}
          </dd>
          <dt className="muted small">Title</dt>
          <dd className="small" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc.metadata.title || '—'}
          </dd>
        </dl>
        <Button size="sm" icon="info" block style={{ marginTop: 8 }} onClick={() => openDialog('metadata')}>
          Document properties
        </Button>
      </div>

      <div className="panel__section">
        <div className="row small muted">
          <Icon name="shield" size={14} />
          Everything stays on this device.
        </div>
      </div>
    </>
  );
}

function describeKind(object: PageObject): string {
  switch (object.kind) {
    case 'text':
      return 'Text box';
    case 'image':
      return object.isSignature ? 'Signature' : 'Image';
    case 'shape':
      return `Shape · ${object.shape}`;
    case 'ink':
      return 'Freehand';
    case 'markup':
      return `Markup · ${object.markup}`;
    case 'note':
      return 'Sticky note';
    case 'redact':
      return 'Redaction';
    case 'field':
      return `Form field · ${object.field}`;
    default:
      return 'Object';
  }
}

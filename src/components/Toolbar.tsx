import { useEditorStore, type ToolId } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { usePlacementStore } from '../state/placementStore';
import { Button, Select } from './ui/controls';
import { Icon, type IconName } from './ui/Icon';
import { HIGHLIGHT_SWATCHES, SWATCHES } from '../lib/util/color';
import { FONT_FAMILIES } from '../lib/pdf/fonts';
import type { FontFamily, FormFieldKind, ShapeKind } from '../types/document';
import { addImagesToCurrentPage, IMAGE_ACCEPT } from '../app/actions';
import { pickFiles } from '../lib/util/file';

interface ToolDef {
  id: ToolId;
  icon: IconName;
  label: string;
  key: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: 'cursor', label: 'Select', key: 'V' },
  { id: 'pan', icon: 'hand', label: 'Pan', key: 'H' },
  { id: 'text', icon: 'text', label: 'Text box', key: 'T' },
  { id: 'edit-text', icon: 'form', label: 'Edit existing text', key: 'E' },
  { id: 'image', icon: 'image', label: 'Image', key: '' },
  { id: 'shape', icon: 'shapes', label: 'Shape', key: 'S' },
  { id: 'ink', icon: 'pen', label: 'Draw', key: 'D' },
  { id: 'highlight', icon: 'highlight', label: 'Highlight', key: 'G' },
  { id: 'underline', icon: 'underline', label: 'Underline', key: '' },
  { id: 'strikeout', icon: 'strikethrough', label: 'Strikethrough', key: '' },
  { id: 'note', icon: 'note', label: 'Sticky note', key: 'N' },
  { id: 'signature', icon: 'signature', label: 'Signature', key: '' },
  { id: 'field', icon: 'form', label: 'Form field', key: 'F' },
  { id: 'redact', icon: 'eye-off', label: 'Redact', key: 'R' },
  { id: 'crop', icon: 'crop', label: 'Crop page', key: 'C' },
];

export function Toolbar() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const settings = useEditorStore((state) => state.toolSettings);
  const setToolSettings = useEditorStore((state) => state.setToolSettings);
  const doc = useEditorStore((state) => state.doc);
  const openDialog = useUiStore((state) => state.openDialog);
  const pending = usePlacementStore((state) => state.pending);

  const onToolClick = async (next: ToolId) => {
    if (next === 'image') {
      const files = await pickFiles(IMAGE_ACCEPT, true);
      if (files.length > 0) await addImagesToCurrentPage(files);
      return;
    }
    if (next === 'signature') {
      openDialog('signature');
      return;
    }
    setTool(next);
  };

  const showStroke = ['shape', 'ink'].includes(tool);
  const showMarkupColor = ['highlight', 'underline', 'strikeout', 'note'].includes(tool);
  const showText = tool === 'text';

  return (
    <div className="toolbar" role="toolbar" aria-label="Editing tools">
      {TOOLS.map((item) => (
        <Button
          key={item.id}
          icon={item.icon}
          iconOnly
          active={tool === item.id}
          disabled={!doc}
          aria-label={item.key ? `${item.label} (${item.key})` : item.label}
          title={item.key ? `${item.label} · ${item.key}` : item.label}
          onClick={() => void onToolClick(item.id)}
        />
      ))}

      <div className="divider-v" />

      <div className="tool-settings">
        {pending && (
          <span className="chip chip--active">
            <Icon name="signature" size={13} /> Click a page to place · Esc to cancel
          </span>
        )}

        {showText && (
          <>
            <Select
              aria-label="Font"
              style={{ width: 110 }}
              value={settings.fontFamily}
              onChange={(event) => setToolSettings({ fontFamily: event.target.value as FontFamily })}
            >
              {FONT_FAMILIES.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Font size"
              style={{ width: 68 }}
              value={settings.fontSize}
              onChange={(event) => setToolSettings({ fontSize: Number(event.target.value) })}
            >
              {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((size) => (
                <option key={size} value={size}>
                  {size} pt
                </option>
              ))}
            </Select>
            <Button
              iconOnly
              active={settings.bold}
              aria-label="Bold"
              onClick={() => setToolSettings({ bold: !settings.bold })}
            >
              <strong style={{ fontSize: 13 }}>B</strong>
            </Button>
            <Button
              iconOnly
              active={settings.italic}
              aria-label="Italic"
              onClick={() => setToolSettings({ italic: !settings.italic })}
            >
              <em style={{ fontSize: 13 }}>I</em>
            </Button>
          </>
        )}

        {tool === 'shape' && (
          <Select
            aria-label="Shape"
            style={{ width: 108 }}
            value={settings.shape}
            onChange={(event) => setToolSettings({ shape: event.target.value as ShapeKind })}
          >
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="line">Line</option>
            <option value="arrow">Arrow</option>
          </Select>
        )}

        {tool === 'field' && (
          <Select
            aria-label="Field type"
            style={{ width: 118 }}
            value={settings.fieldKind}
            onChange={(event) => setToolSettings({ fieldKind: event.target.value as FormFieldKind })}
          >
            <option value="text">Text field</option>
            <option value="checkbox">Checkbox</option>
            <option value="dropdown">Dropdown</option>
            <option value="radio">Radio button</option>
          </Select>
        )}

        {(showStroke || showText) && (
          <>
            <label className="field__label" htmlFor="tool-colour">
              Colour
            </label>
            <input
              id="tool-colour"
              type="color"
              className="color-input"
              value={settings.color}
              onChange={(event) => setToolSettings({ color: event.target.value })}
            />
            {SWATCHES.slice(0, 6).map((colour) => (
              <button
                key={colour}
                type="button"
                className={`swatch ${settings.color === colour ? 'swatch--active' : ''}`}
                style={{ background: colour }}
                aria-label={`Use colour ${colour}`}
                onClick={() => setToolSettings({ color: colour })}
              />
            ))}
          </>
        )}

        {showMarkupColor && (
          <>
            <span className="field__label">Colour</span>
            {HIGHLIGHT_SWATCHES.map((colour) => (
              <button
                key={colour}
                type="button"
                className={`swatch ${settings.highlightColor === colour ? 'swatch--active' : ''}`}
                style={{ background: colour }}
                aria-label={`Use colour ${colour}`}
                onClick={() => setToolSettings({ highlightColor: colour })}
              />
            ))}
          </>
        )}

        {showStroke && (
          <>
            <label className="field__label" htmlFor="stroke-width">
              Width
            </label>
            <input
              id="stroke-width"
              className="range"
              style={{ width: 90 }}
              type="range"
              min={0.5}
              max={12}
              step={0.5}
              value={settings.strokeWidth}
              onChange={(event) => setToolSettings({ strokeWidth: Number(event.target.value) })}
            />
            <span className="small muted" style={{ width: 30 }}>
              {settings.strokeWidth}
            </span>
          </>
        )}

        {tool === 'shape' && (
          <label className="checkbox small">
            <input
              type="checkbox"
              checked={settings.fillColor !== null}
              onChange={(event) => setToolSettings({ fillColor: event.target.checked ? '#ffffff' : null })}
            />
            Fill
            {settings.fillColor !== null && (
              <input
                type="color"
                className="color-input"
                aria-label="Fill colour"
                value={settings.fillColor}
                onChange={(event) => setToolSettings({ fillColor: event.target.value })}
              />
            )}
          </label>
        )}

        {tool === 'redact' && (
          <span className="chip">
            <Icon name="alert" size={13} /> Content under a redaction is destroyed on export
          </span>
        )}

        {tool === 'crop' && <span className="chip">Drag on the page to set the visible area</span>}
      </div>
    </div>
  );
}

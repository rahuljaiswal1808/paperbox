import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useUiStore } from '../../state/uiStore';
import { usePlacementStore } from '../../state/placementStore';
import { Button, Checkbox, Field, Modal, Note, Select, TextInput } from '../ui/controls';
import { createImageAsset, trimTransparent } from '../../lib/ops/assets';
import { canvasToBytes } from '../../lib/pdf/raster';
import { deleteSignature, listSignatures, saveSignature, type StoredSignature } from '../../lib/storage/db';
import { pickFiles } from '../../lib/util/file';
import { uid } from '../../lib/util/misc';
import type { Asset } from '../../types/document';

type Tab = 'draw' | 'type' | 'upload';

const SCRIPT_FONTS = [
  { id: '"Segoe Script", "Bradley Hand", cursive', label: 'Handwriting' },
  { id: '"Brush Script MT", "Snell Roundhand", cursive', label: 'Brush script' },
  { id: 'Georgia, "Times New Roman", serif', label: 'Formal serif' },
  { id: '"Helvetica Neue", Arial, sans-serif', label: 'Plain' },
];

export function SignatureDialog() {
  const close = useUiStore((state) => state.closeDialog);
  const addAsset = useEditorStore((state) => state.addAsset);
  const [tab, setTab] = useState<Tab>('draw');
  const [saved, setSaved] = useState<StoredSignature[]>([]);
  const [preview, setPreview] = useState<{ asset: Asset; url: string } | null>(null);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    listSignatures().then(setSaved).catch(() => undefined);
  }, []);

  const setPreviewAsset = (asset: Asset) => {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return {
        asset,
        url: URL.createObjectURL(new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.type })),
      };
    });
  };

  const arm = async (asset: Asset, name: string) => {
    addAsset(asset);
    if (remember) {
      const signature: StoredSignature = { id: uid('sig'), name, asset, createdAt: Date.now() };
      await saveSignature(signature).catch(() => undefined);
    }
    usePlacementStore.getState().setPending({
      kind: 'signature',
      assetId: asset.id,
      aspect: asset.width / asset.height,
      width: 160,
      label: name,
    });
    useEditorStore.getState().setTool('select');
    close();
    useUiStore.getState().toast({
      kind: 'info',
      title: 'Click a page to place your signature',
      detail: 'Drag the handles to resize it, Esc to cancel.',
    });
  };

  return (
    <Modal
      title="Signatures"
      icon="signature"
      onClose={close}
      wide
      description="Signatures are created here and stored only in this browser."
      footer={
        <>
          <Checkbox checked={remember} onChange={setRemember} label="Save for reuse on this device" />
          <span className="spacer" />
          <Button onClick={close}>Close</Button>
          <Button
            variant="primary"
            icon="signature"
            disabled={!preview}
            onClick={() => preview && void arm(preview.asset, `Signature ${saved.length + 1}`)}
          >
            Use signature
          </Button>
        </>
      }
    >
      <div className="tabs" role="tablist" aria-label="Signature source">
        {(
          [
            ['draw', 'Draw'],
            ['type', 'Type'],
            ['upload', 'Upload image'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'draw' && <DrawPad onCreate={setPreviewAsset} />}
      {tab === 'type' && <TypePad onCreate={setPreviewAsset} />}
      {tab === 'upload' && <UploadPad onCreate={setPreviewAsset} />}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div className="panel__title">Preview</div>
          <div className="signature-preview">
            <img src={preview.url} alt="Signature preview" />
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="panel__title">Saved signatures</div>
          <div className="file-list">
            {saved.map((signature) => (
              <div className="file-row" key={signature.id}>
                <SavedThumb asset={signature.asset} />
                <span className="file-row__name">{signature.name}</span>
                <Button
                  size="sm"
                  onClick={() => {
                    setRemember(false);
                    void arm({ ...signature.asset, id: uid('img') }, signature.name);
                  }}
                >
                  Place
                </Button>
                <Button
                  icon="trash"
                  iconOnly
                  size="sm"
                  aria-label={`Delete ${signature.name}`}
                  onClick={async () => {
                    await deleteSignature(signature.id);
                    setSaved(await listSignatures());
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function SavedThumb({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(
      new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.type }),
    );
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [asset]);
  return url ? <img src={url} alt="" style={{ height: 26, background: '#fff' }} /> : <span style={{ width: 26 }} />;
}

function DrawPad({ onCreate }: { onCreate: (asset: Asset) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [colour, setColour] = useState('#0f172a');
  const [width, setWidth] = useState(2.6);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    const ctx = canvas.getContext('2d');
    ctx?.scale(ratio, ratio);
  }, []);

  const position = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    setEmpty(false);
    const point = position(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const move = (event: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const point = position(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  };

  const commit = async () => {
    const canvas = canvasRef.current;
    if (!canvas || empty) return;
    const trimmed = await trimTransparent(canvas);
    const bytes = await canvasToBytes(trimmed, 'image/png', 1);
    onCreate({
      id: uid('img'),
      type: 'image/png',
      bytes,
      width: trimmed.width,
      height: trimmed.height,
    });
  };

  return (
    <div className="stack">
      <canvas
        ref={canvasRef}
        className="signature-pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        aria-label="Signature drawing area"
      />
      <div className="row">
        <input
          type="color"
          className="color-input"
          aria-label="Ink colour"
          value={colour}
          onChange={(event) => setColour(event.target.value)}
        />
        <input
          className="range"
          style={{ width: 120 }}
          type="range"
          min={1}
          max={8}
          step={0.2}
          aria-label="Pen width"
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
        />
        <span className="grow" />
        <Button onClick={clear}>Clear</Button>
        <Button variant="outline" disabled={empty} onClick={() => void commit()}>
          Use this drawing
        </Button>
      </div>
    </div>
  );
}

function TypePad({ onCreate }: { onCreate: (asset: Asset) => void }) {
  const [text, setText] = useState('');
  const [font, setFont] = useState(SCRIPT_FONTS[0].id);
  const [colour, setColour] = useState('#0f172a');

  const commit = async () => {
    if (!text.trim()) return;
    const canvas = document.createElement('canvas');
    const scale = 3;
    const fontSize = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${fontSize}px ${font}`;
    const metrics = ctx.measureText(text);
    canvas.width = Math.ceil((metrics.width + 40) * scale);
    canvas.height = Math.ceil(fontSize * 2 * scale);
    const ctx2 = canvas.getContext('2d');
    if (!ctx2) return;
    ctx2.scale(scale, scale);
    ctx2.font = `${fontSize}px ${font}`;
    ctx2.fillStyle = colour;
    ctx2.textBaseline = 'middle';
    ctx2.fillText(text, 20, fontSize);
    const trimmed = await trimTransparent(canvas);
    const bytes = await canvasToBytes(trimmed, 'image/png', 1);
    onCreate({ id: uid('img'), type: 'image/png', bytes, width: trimmed.width, height: trimmed.height });
  };

  return (
    <div className="stack">
      <Field label="Your name">
        {(id) => (
          <TextInput
            id={id}
            value={text}
            placeholder="Alex Morgan"
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </Field>
      <div className="field-row">
        <Field label="Style">
          {(id) => (
            <Select id={id} value={font} onChange={(event) => setFont(event.target.value)}>
              {SCRIPT_FONTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
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
      <div
        className="signature-preview"
        style={{ fontFamily: font, fontSize: 34, color: colour, height: 80 }}
        aria-hidden
      >
        {text || 'Preview'}
      </div>
      <Button variant="outline" disabled={!text.trim()} onClick={() => void commit()}>
        Use this signature
      </Button>
      <Note kind="info">
        The typed signature is converted to an image, so it looks the same in every PDF reader.
      </Note>
    </div>
  );
}

function UploadPad({ onCreate }: { onCreate: (asset: Asset) => void }) {
  const [removeBackground, setRemoveBackground] = useState(true);

  const choose = async () => {
    const [file] = await pickFiles('image/*', false);
    if (!file) return;
    const asset = await createImageAsset(file);
    if (!removeBackground) {
      onCreate(asset);
      return;
    }
    const bitmap = await createImageBitmap(
      new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.type }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      if (luminance > 0.8) data[i + 3] = 0;
      else if (luminance > 0.55) data[i + 3] = Math.round(data[i + 3] * (1 - (luminance - 0.55) / 0.25));
    }
    ctx.putImageData(image, 0, 0);
    const trimmed = await trimTransparent(canvas);
    const bytes = await canvasToBytes(trimmed, 'image/png', 1);
    onCreate({ id: uid('img'), type: 'image/png', bytes, width: trimmed.width, height: trimmed.height });
  };

  return (
    <div className="stack">
      <Checkbox
        checked={removeBackground}
        onChange={setRemoveBackground}
        label="Remove the white background (best for a photo of a signature on paper)"
      />
      <Button variant="outline" icon="image" onClick={() => void choose()}>
        Choose an image
      </Button>
      <Note kind="info">The image is processed in this tab; nothing is uploaded.</Note>
    </div>
  );
}

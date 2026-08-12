import { useMemo, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useUiStore, withProgress } from '../../state/uiStore';
import { useSecurityStore } from '../../state/securityStore';
import { Button, Checkbox, Field, Modal, Note, Select, TextInput } from '../ui/controls';
import { COMPRESSION_PRESETS, compressionSummary, presetById, type CompressionLevel } from '../../lib/ops/compress';
import { exportDocument } from '../../app/actions';
import { exportPdf } from '../../lib/worker/client';
import { pdfToImages, pdfToText, type ImageFormat } from '../../lib/ops/convert';
import { downloadBytes, downloadZip } from '../../lib/util/file';
import { formatBytes, parsePageRanges, sanitizeFilename } from '../../lib/util/misc';
import { pageNeedsFlattening } from '../../lib/pdf/export';

const usePageSelection = () => {
  const doc = useEditorStore((state) => state.doc);
  const selected = useEditorStore((state) => state.selectedPageIndexes);
  const count = doc?.pages.length ?? 0;
  const [mode, setMode] = useState<'all' | 'selection' | 'range'>(selected.length > 1 ? 'selection' : 'all');
  const [range, setRange] = useState('1-end');

  const pages = useMemo(() => {
    if (mode === 'all') return Array.from({ length: count }, (_, i) => i);
    if (mode === 'selection') return selected.length > 0 ? [...selected].sort((a, b) => a - b) : [];
    return parsePageRanges(range, count);
  }, [mode, range, selected, count]);

  const control = (
    <div className="stack">
      <div className="chips">
        {(['all', 'selection', 'range'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`chip ${mode === option ? 'chip--active' : ''}`}
            onClick={() => setMode(option)}
          >
            {option === 'all' ? `All ${count} pages` : option === 'selection' ? `Selected (${selected.length})` : 'Range'}
          </button>
        ))}
      </div>
      {mode === 'range' && (
        <Field label="Pages" hint="For example 1-3, 7, 12-end">
          {(id) => <TextInput id={id} value={range} onChange={(event) => setRange(event.target.value)} />}
        </Field>
      )}
    </div>
  );

  return { pages, control };
};

export function ExportDialog() {
  const doc = useEditorStore((state) => state.doc);
  const close = useUiStore((state) => state.closeDialog);
  const security = useSecurityStore();
  const openDialog = useUiStore((state) => state.openDialog);
  const [objectStreams, setObjectStreams] = useState(true);
  const [pdfa, setPdfa] = useState<'' | '1B' | '2B' | '3B'>('');
  const [filename, setFilename] = useState(doc ? `${sanitizeFilename(doc.name)}.pdf` : 'document.pdf');
  const { pages, control } = usePageSelection();

  const redactedPages = doc?.pages.filter(pageNeedsFlattening).length ?? 0;

  return (
    <Modal
      title="Export PDF"
      icon="download"
      onClose={close}
      description="The file is written in this tab and saved straight to your downloads folder."
      footer={
        <>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            icon="download"
            disabled={pages.length === 0}
            onClick={async () => {
              close();
              await exportDocument({
                filename,
                pages,
                useObjectStreams: objectStreams,
                pdfa: pdfa || null,
                rasterizeAll: pdfa !== '',
                rasterDpi: 200,
                rasterQuality: 0.92,
              });
            }}
          >
            Export {pages.length} page{pages.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <Field label="File name">
        {(id) => <TextInput id={id} value={filename} onChange={(event) => setFilename(event.target.value)} />}
      </Field>

      {control}

      <div style={{ height: 14 }} />

      <Checkbox
        checked={objectStreams}
        onChange={setObjectStreams}
        label="Compress the file structure (PDF 1.5 object streams)"
      />

      <Field label="PDF/A archival format" hint="Rasterises pages so no font or transparency rules can be broken.">
        {(id) => (
          <Select id={id} value={pdfa} onChange={(event) => setPdfa(event.target.value as typeof pdfa)}>
            <option value="">Standard PDF</option>
            <option value="2B">PDF/A-2B (rasterised, best effort)</option>
            <option value="3B">PDF/A-3B (rasterised, best effort)</option>
            <option value="1B">PDF/A-1B (rasterised, best effort)</option>
          </Select>
        )}
      </Field>

      {pdfa && (
        <Note kind="warning">
          PDF/A output is produced by re-rendering each page as an image and embedding an sRGB output
          intent. That guarantees the fonts and colour rules, but the text is no longer selectable.
          Validate with veraPDF if you need certified conformance.
        </Note>
      )}

      {redactedPages > 0 && (
        <Note kind="info">
          {redactedPages} page{redactedPages === 1 ? '' : 's'} will be flattened to remove redacted
          content permanently.
        </Note>
      )}

      <div className="row" style={{ marginTop: 6 }}>
        <span className="grow small muted">
          Password protection: <strong>{security.enabled ? 'on' : 'off'}</strong>
        </span>
        <Button size="sm" icon="lock" onClick={() => openDialog('protect')}>
          Change
        </Button>
      </div>
    </Modal>
  );
}

export function CompressDialog() {
  const doc = useEditorStore((state) => state.doc);
  const close = useUiStore((state) => state.closeDialog);
  const [level, setLevel] = useState<CompressionLevel>('balanced');
  const [result, setResult] = useState<{ before: number; after: number; bytes: Uint8Array } | null>(null);

  const originalSize = useMemo(
    () => Object.values(doc?.sources ?? {}).reduce((total, source) => total + source.bytes.byteLength, 0),
    [doc],
  );

  const preset = presetById(level);

  const run = async () => {
    if (!doc) return;
    const output = await withProgress(
      'Compressing',
      async (report, signal) =>
        exportPdf(doc, {
          ...preset.options,
          onProgress: report,
          signal,
          security: useSecurityStore.getState().forExport(),
        }),
      { errorTitle: 'Compression failed' },
    );
    if (!output) return;
    setResult({ before: originalSize, after: output.bytes.byteLength, bytes: output.bytes });
  };

  return (
    <Modal
      title="Compress PDF"
      icon="compress"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={close}>Close</Button>
          {result ? (
            <Button
              variant="primary"
              icon="download"
              onClick={() => {
                downloadBytes(result.bytes, `${sanitizeFilename(doc?.name ?? 'document')}-compressed.pdf`);
                close();
              }}
            >
              Save {formatBytes(result.after)}
            </Button>
          ) : (
            <Button variant="primary" icon="compress" onClick={() => void run()}>
              Compress
            </Button>
          )}
        </>
      }
    >
      <div className="option-list">
        {COMPRESSION_PRESETS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`option ${level === option.id ? 'option--active' : ''}`}
            onClick={() => {
              setLevel(option.id);
              setResult(null);
            }}
          >
            <input type="radio" checked={level === option.id} readOnly aria-hidden tabIndex={-1} />
            <span>
              <span className="option__title">{option.label}</span>
              <span className="option__desc"> {option.description}</span>
              {!option.keepsText && (
                <span className="option__desc"> Text becomes part of the image and is no longer selectable.</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {result && (
        <Note kind={result.after < result.before ? 'info' : 'warning'}>
          {formatBytes(result.before)} → {formatBytes(result.after)} · {compressionSummary(result.before, result.after)}
        </Note>
      )}
    </Modal>
  );
}

export function ExportImagesDialog() {
  const doc = useEditorStore((state) => state.doc);
  const close = useUiStore((state) => state.closeDialog);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.92);
  const [zip, setZip] = useState(true);
  const { pages, control } = usePageSelection();

  const run = async () => {
    if (!doc) return;
    const files = await withProgress(
      'Rendering pages',
      async (report, signal) =>
        pdfToImages(doc, { format, dpi, quality, pages }, report, signal),
      { errorTitle: 'Could not export images' },
    );
    if (!files || files.length === 0) return;
    if (zip && files.length > 1) downloadZip(files, `${sanitizeFilename(doc.name)}-images.zip`);
    else for (const file of files) downloadBytes(file.bytes, file.name, `image/${format}`);
    close();
    useUiStore.getState().toast({ kind: 'success', title: `Exported ${files.length} image(s)` });
  };

  return (
    <Modal
      title="PDF to images"
      icon="image"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon="image" disabled={pages.length === 0} onClick={() => void run()}>
            Export {pages.length} image{pages.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {control}
      <div style={{ height: 12 }} />
      <div className="field-row">
        <Field label="Format">
          {(id) => (
            <Select id={id} value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)}>
              <option value="png">PNG · lossless</option>
              <option value="jpeg">JPG · small</option>
              <option value="webp">WebP · smallest</option>
            </Select>
          )}
        </Field>
        <Field label="Resolution">
          {(id) => (
            <Select id={id} value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
              <option value={72}>72 DPI · screen</option>
              <option value={150}>150 DPI · standard</option>
              <option value={300}>300 DPI · print</option>
              <option value={600}>600 DPI · archive</option>
            </Select>
          )}
        </Field>
      </div>
      {format !== 'png' && (
        <Field label={`Quality · ${Math.round(quality * 100)}%`}>
          {(id) => (
            <input
              id={id}
              className="range"
              type="range"
              min={0.3}
              max={1}
              step={0.05}
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
          )}
        </Field>
      )}
      <Checkbox checked={zip} onChange={setZip} label="Bundle into a single .zip" />
    </Modal>
  );
}

export function ExportTextDialog() {
  const doc = useEditorStore((state) => state.doc);
  const close = useUiStore((state) => state.closeDialog);
  const { pages, control } = usePageSelection();
  const [preview, setPreview] = useState<string | null>(null);

  const run = async (download: boolean) => {
    if (!doc) return;
    const text = await withProgress('Extracting text', async (report) => pdfToText(doc, pages, report), {
      errorTitle: 'Could not extract text',
    });
    if (text === null) return;
    if (download) {
      downloadBytes(new TextEncoder().encode(text), `${sanitizeFilename(doc.name)}.txt`, 'text/plain');
      close();
    } else {
      setPreview(text.slice(0, 4000));
    }
  };

  return (
    <Modal
      title="PDF to text"
      icon="text"
      onClose={close}
      footer={
        <>
          <Button onClick={() => void run(false)}>Preview</Button>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon="download" onClick={() => void run(true)}>
            Download .txt
          </Button>
        </>
      }
    >
      {control}
      <Note kind="info">
        Text is read from the PDF's own content. Scanned pages have no text layer — run OCR first.
      </Note>
      {preview !== null && (
        <pre
          className="mono"
          style={{
            maxHeight: 260,
            overflow: 'auto',
            background: 'var(--surface-2)',
            padding: 10,
            borderRadius: 8,
            whiteSpace: 'pre-wrap',
          }}
        >
          {preview || '(no text found)'}
        </pre>
      )}
    </Modal>
  );
}

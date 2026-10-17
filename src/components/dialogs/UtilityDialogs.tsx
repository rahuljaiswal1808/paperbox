import { useState } from 'react';
import { PDFDocument } from '@cantoo/pdf-lib';
import { useUiStore, withProgress } from '../../state/uiStore';
import { Button, Modal, Note } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SHORTCUTS } from '../../app/hooks';
import { PDF_ACCEPT } from '../../app/actions';
import { pickFiles, readFileBytes, downloadBytes } from '../../lib/util/file';
import { formatBytes, sanitizeFilename, stripExtension } from '../../lib/util/misc';
import { repairPdf, type RepairResult } from '../../lib/ops/repair';
import { openPdfDetached, renderPageToBitmap } from '../../lib/pdf/pdfjs';
import { canvasToBytes } from '../../lib/pdf/raster';

/** Last-resort rebuild: render whatever pdf.js can still draw into a new file. */
async function rebuildByRendering(
  bytes: Uint8Array,
  onProgress?: (fraction: number, label: string) => void,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const { doc: source, close: closeSource } = await openPdfDetached(bytes);
  const out = await PDFDocument.create();
  let recovered = 0;

  for (let i = 1; i <= source.numPages; i += 1) {
    onProgress?.(0.5 + (0.5 * i) / source.numPages, `Recovering page ${i} of ${source.numPages}`);
    try {
      const page = await source.getPage(i);
      const canvas = await renderPageToBitmap(page, 150 / 72);
      const jpeg = await canvasToBytes(canvas, 'image/jpeg', 0.85);
      const image = await out.embedJpg(jpeg);
      const viewport = page.getViewport({ scale: 1 });
      const pdfPage = out.addPage([viewport.width, viewport.height]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      recovered += 1;
    } catch {
      // Skip pages that cannot be rendered at all.
    }
  }

  await closeSource();
  if (recovered === 0) throw new Error('No pages in this file could be recovered.');
  return { bytes: await out.save({ useObjectStreams: true }), pageCount: recovered };
}

export function RepairDialog() {
  const close = useUiStore((state) => state.closeDialog);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<RepairResult | null>(null);

  const run = async (picked: File) => {
    setFile(picked);
    setResult(null);
    const output = await withProgress(
      `Repairing ${picked.name}`,
      async (report) => {
        const bytes = await readFileBytes(picked);
        return repairPdf(bytes, rebuildByRendering, report);
      },
      { errorTitle: 'This file could not be repaired' },
    );
    if (output) setResult(output);
  };

  return (
    <Modal
      title="Repair a PDF"
      icon="repair"
      onClose={close}
      description="Rebuilds a damaged file's structure, or falls back to recovering whatever still renders."
      footer={
        <>
          <Button
            icon="folder-open"
            onClick={async () => {
              const [picked] = await pickFiles(PDF_ACCEPT, false);
              if (picked) await run(picked);
            }}
          >
            Choose file
          </Button>
          <span className="spacer" />
          <Button onClick={close}>Close</Button>
          {result && (
            <Button
              variant="primary"
              icon="download"
              onClick={() => {
                downloadBytes(result.bytes, `${sanitizeFilename(stripExtension(file?.name ?? 'document'))}-repaired.pdf`);
                close();
              }}
            >
              Save repaired file
            </Button>
          )}
        </>
      }
    >
      {!file && (
        <div className="empty">
          <Icon name="repair" size={22} />
          <p>Choose a PDF that will not open or render correctly.</p>
        </div>
      )}

      {result && (
        <>
          <Note kind={result.strategy === 'structure' ? 'info' : 'warning'}>
            {result.strategy === 'structure'
              ? 'Repaired by rebuilding the file structure.'
              : 'Repaired by re-rendering the pages that could still be read.'}
          </Note>
          <ul className="small muted">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="small">
            {result.pageCount} page{result.pageCount === 1 ? '' : 's'} recovered ·{' '}
            {formatBytes(result.bytes.byteLength)}
          </p>
        </>
      )}
    </Modal>
  );
}

export function ShortcutsDialog() {
  const close = useUiStore((state) => state.closeDialog);
  const groups = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))];

  return (
    <Modal title="Keyboard shortcuts" onClose={close} wide footer={<><span className="spacer" /><Button variant="primary" onClick={close}>Close</Button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
        {groups.map((group) => (
          <section key={group}>
            <div className="panel__title">{group}</div>
            <div className="shortcut-grid">
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.label} style={{ display: 'contents' }}>
                  <span className="small">{shortcut.label}</span>
                  <span className="kbd">{shortcut.keys}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function PrivacyDialog() {
  const close = useUiStore((state) => state.closeDialog);
  return (
    <Modal
      title="How your files are handled"
      icon="shield"
      onClose={close}
      footer={<><span className="spacer" /><Button variant="primary" onClick={close}>Close</Button></>}
    >
      <Note kind="info">No PDF you open is ever sent to a server. There is no server.</Note>
      <ul>
        <li>
          <strong>Reading.</strong> Files are read with the browser's own file APIs and kept in this
          tab's memory. Rendering runs in a Web Worker on your CPU.
        </li>
        <li>
          <strong>Editing.</strong> Every operation — merging, splitting, compressing, signing,
          encrypting, converting — is computed locally with pdf.js and pdf-lib.
        </li>
        <li>
          <strong>Saving.</strong> Exports are generated in memory and handed to your browser's
          download mechanism. They go straight to your disk.
        </li>
        <li>
          <strong>Autosave.</strong> Your working document is written to IndexedDB in this browser so
          a crash or accidental reload does not lose work. Closing the document clears it.
        </li>
        <li>
          <strong>Offline.</strong> The app and all of its rendering assets are cached by a service
          worker. Disconnect the network and everything still works.
        </li>
        <li>
          <strong>Analytics.</strong> None. No trackers, no accounts, no telemetry.
        </li>
      </ul>
      <p className="small muted">
        The one thing to know: redaction is only permanent after export, because it works by
        rebuilding the affected pages without the removed content.
      </p>
    </Modal>
  );
}

export function AboutDialog() {
  const close = useUiStore((state) => state.closeDialog);
  return (
    <Modal
      title="About Paperbox"
      icon="info"
      onClose={close}
      footer={<><span className="spacer" /><Button variant="primary" onClick={close}>Close</Button></>}
    >
      <p>
        <strong>Paperbox</strong> is a complete PDF workspace that runs on your machine. It is a
        browser application with no backend: open a file, work on it, export it.
      </p>
      <p className="small muted">
        Build <code className="mono">{__BUILD_ID__}</code>
        <br />
        If that does not match the latest commit, your browser is still serving a cached copy:
        reload twice, or clear this site&rsquo;s data.
      </p>
      <div className="panel__title">Built with</div>
      <ul className="small">
        <li>React + TypeScript, bundled by Vite</li>
        <li>pdf.js for rendering, text extraction and search</li>
        <li>pdf-lib (Cantoo fork) for writing, encryption and PDF/A output</li>
        <li>Web Workers for page parsing and file assembly</li>
        <li>IndexedDB for session recovery and saved signatures</li>
        <li>A service worker so the whole app works offline</li>
      </ul>
      <div className="panel__title">Known limits</div>
      <ul className="small muted">
        <li>Editing existing text places an opaque box over the original line rather than reflowing the source paragraph.</li>
        <li>New text uses the 14 standard PDF fonts, so characters outside WinAnsi are substituted.</li>
        <li>OCR and Office-format conversion are extension points, not bundled features.</li>
      </ul>
    </Modal>
  );
}

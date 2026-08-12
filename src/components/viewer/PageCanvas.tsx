import { useEffect, useRef, useState } from 'react';
import type { EditorDocument, PageState } from '../../types/document';
import { openPdf, renderPageToCanvas } from '../../lib/pdf/pdfjs';
import { viewRect } from '../../lib/pdf/geometry';

interface PageCanvasProps {
  doc: EditorDocument;
  page: PageState;
  zoom: number;
  epoch: number;
  /** Skip rendering entirely for pages far outside the viewport. */
  visible: boolean;
}

/**
 * Renders one PDF page with pdf.js. Re-rendering is debounced so dragging the
 * zoom slider stays smooth: the previous bitmap is stretched by CSS until the
 * sharper render lands.
 */
export function PageCanvas({ doc, page, zoom, epoch, visible }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const view = viewRect(page);

  useEffect(() => {
    if (!visible || !page.sourceId) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const controller = new AbortController();
    let timer = 0;

    const run = async () => {
      try {
        setStatus('rendering');
        const source = doc.sources[page.sourceId as string];
        if (!source) throw new Error('The source file for this page is missing');
        const pdf = await openPdf(page.sourceId as string, source.bytes, source.password);
        if (controller.signal.aborted) return;
        if (page.sourceIndex >= pdf.numPages) throw new Error('This page no longer exists in the source file');
        const pdfPage = await pdf.getPage(page.sourceIndex + 1);
        if (controller.signal.aborted) return;
        await renderPageToCanvas(pdfPage, {
          scale: zoom,
          rotation: page.rotation,
          canvas,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setStatus('ready');
          setError(null);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const name = (err as Error).name;
        if (name === 'RenderingCancelledException' || name === 'AbortError') return;
        setStatus('error');
        setError((err as Error).message);
      }
    };

    timer = window.setTimeout(run, 90);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [doc, page, page.rotation, page.sourceId, page.sourceIndex, zoom, epoch, visible]);

  if (!page.sourceId) {
    return <div className="page__canvas-wrap" style={{ background: '#fff' }} />;
  }

  return (
    <div className="page__canvas-wrap">
      <canvas
        ref={canvasRef}
        className="page__canvas"
        style={{
          left: -view.x * zoom,
          top: -view.y * zoom,
          width: page.width * zoom,
          height: page.height * zoom,
        }}
        aria-hidden="true"
      />
      {status === 'error' && (
        <div className="page__placeholder">
          <div style={{ textAlign: 'center', padding: 16 }}>
            <strong>Page could not be rendered</strong>
            <div className="small muted">{error}</div>
          </div>
        </div>
      )}
      {status !== 'ready' && status !== 'error' && visible && (
        <div className="page__placeholder">Rendering…</div>
      )}
    </div>
  );
}

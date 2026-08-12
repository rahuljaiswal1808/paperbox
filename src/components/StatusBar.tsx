import { useEditorStore } from '../state/editorStore';
import { Button, Select } from './ui/controls';
import { Icon } from './ui/Icon';
import { formatDate } from '../lib/util/misc';

interface StatusBarProps {
  savedAt: number | null;
  online: boolean;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function StatusBar({ savedAt, online }: StatusBarProps) {
  const doc = useEditorStore((state) => state.doc);
  const currentPage = useEditorStore((state) => state.currentPage);
  const setCurrentPage = useEditorStore((state) => state.setCurrentPage);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const zoomBy = useEditorStore((state) => state.zoomBy);
  const sidebar = useEditorStore((state) => state.sidebar);
  const setSidebar = useEditorStore((state) => state.setSidebar);
  const fullscreen = useEditorStore((state) => state.fullscreen);
  const setFullscreen = useEditorStore((state) => state.setFullscreen);

  const pageCount = doc?.pages.length ?? 0;

  return (
    <footer className="statusbar">
      <Button
        icon="layers"
        iconOnly
        size="sm"
        active={sidebar !== null}
        aria-label="Toggle sidebar"
        onClick={() => setSidebar(sidebar ? null : 'thumbnails')}
      />

      {doc && (
        <>
          <label className="sr-only" htmlFor="page-number">
            Page number
          </label>
          <input
            id="page-number"
            className="page-input"
            type="number"
            min={1}
            max={pageCount}
            value={currentPage + 1}
            onChange={(event) => setCurrentPage(Number(event.target.value) - 1)}
          />
          <span>of {pageCount}</span>
          <Button
            icon="chevron-up"
            iconOnly
            size="sm"
            aria-label="Previous page"
            disabled={currentPage === 0}
            onClick={() => setCurrentPage(currentPage - 1)}
          />
          <Button
            icon="chevron-down"
            iconOnly
            size="sm"
            aria-label="Next page"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setCurrentPage(currentPage + 1)}
          />
        </>
      )}

      <div className="statusbar__spacer" />

      {savedAt && (
        <span title="Autosaved to this browser for crash recovery">
          Session saved {formatDate(savedAt).split(', ').pop()}
        </span>
      )}

      <span className="badge-local" title="No file has been uploaded anywhere">
        <Icon name="shield" size={12} />
        {online ? 'Local processing' : 'Offline · fully functional'}
      </span>

      <Button icon="zoom-out" iconOnly size="sm" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)} />
      <label className="sr-only" htmlFor="zoom-select">
        Zoom level
      </label>
      <Select
        id="zoom-select"
        style={{ width: 108, height: 22 }}
        value={typeof zoom === 'number' ? 'custom' : zoom}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'fit-width' || value === 'fit-page') setZoom(value);
          else setZoom(Number(value));
        }}
      >
        <option value="fit-width">Fit width</option>
        <option value="fit-page">Fit page</option>
        {typeof zoom === 'number' && <option value="custom">{Math.round(zoom * 100)}%</option>}
        {ZOOM_STEPS.map((step) => (
          <option key={step} value={step}>
            {step * 100}%
          </option>
        ))}
      </Select>
      <Button icon="zoom-in" iconOnly size="sm" aria-label="Zoom in" onClick={() => zoomBy(1.2)} />
      <Button
        icon="expand"
        iconOnly
        size="sm"
        active={fullscreen}
        aria-label="Toggle fullscreen (F11)"
        onClick={() => setFullscreen(!fullscreen)}
      />
    </footer>
  );
}

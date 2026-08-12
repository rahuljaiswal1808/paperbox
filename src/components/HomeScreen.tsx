import { useEffect, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { Button } from './ui/controls';
import { Icon, type IconName } from './ui/Icon';
import { listRecent, type RecentEntry } from '../lib/storage/db';
import { IMAGE_ACCEPT, openImagesAsPdf, promptOpenPdf } from '../app/actions';
import { pickFiles } from '../lib/util/file';
import { formatDate } from '../lib/util/misc';

interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  run: () => void;
}

export function HomeScreen({ dragActive }: { dragActive: boolean }) {
  const doc = useEditorStore((state) => state.doc);
  const openDialog = useUiStore((state) => state.openDialog);
  const setShowHomeScreen = useUiStore((state) => state.setShowHomeScreen);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  useEffect(() => {
    listRecent().then(setRecent).catch(() => undefined);
  }, []);

  const needsDoc = (action: () => void) => () => {
    if (!doc) {
      void promptOpenPdf();
      return;
    }
    setShowHomeScreen(false);
    action();
  };

  const actions: QuickAction[] = [
    {
      id: 'open',
      title: 'Open PDF',
      description: 'View, search and navigate',
      icon: 'folder-open',
      run: () => void promptOpenPdf(),
    },
    {
      id: 'edit',
      title: 'Edit PDF',
      description: 'Text, images and annotations',
      icon: 'text',
      run: needsDoc(() => useEditorStore.getState().setTool('edit-text')),
    },
    {
      id: 'merge',
      title: 'Merge',
      description: 'Combine several PDFs',
      icon: 'merge',
      run: () => openDialog('merge'),
    },
    {
      id: 'split',
      title: 'Split',
      description: 'By range or selection',
      icon: 'split',
      run: needsDoc(() => openDialog('split')),
    },
    {
      id: 'compress',
      title: 'Compress',
      description: 'Four quality levels',
      icon: 'compress',
      run: needsDoc(() => openDialog('compress')),
    },
    {
      id: 'sign',
      title: 'Sign',
      description: 'Draw, type or upload',
      icon: 'signature',
      run: needsDoc(() => openDialog('signature')),
    },
    {
      id: 'convert',
      title: 'Convert',
      description: 'PDF to PNG, JPG, WebP or text',
      icon: 'convert',
      run: needsDoc(() => openDialog('export-images')),
    },
    {
      id: 'images',
      title: 'Images to PDF',
      description: 'Photos and scans into one file',
      icon: 'image',
      run: async () => {
        const files = await pickFiles(IMAGE_ACCEPT, true);
        if (files.length > 0) await openImagesAsPdf(files);
      },
    },
    {
      id: 'protect',
      title: 'Protect',
      description: 'Password and permissions',
      icon: 'lock',
      run: needsDoc(() => openDialog('protect')),
    },
    {
      id: 'redact',
      title: 'Redact',
      description: 'Remove content for good',
      icon: 'eye-off',
      run: needsDoc(() => useEditorStore.getState().setTool('redact')),
    },
    {
      id: 'repair',
      title: 'Repair',
      description: 'Recover a damaged file',
      icon: 'repair',
      run: () => openDialog('repair'),
    },
    {
      id: 'metadata',
      title: 'Properties',
      description: 'Title, author, bookmarks',
      icon: 'info',
      run: needsDoc(() => openDialog('metadata')),
    },
  ];

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__hero">
          <h1>A complete PDF workspace that runs on your machine.</h1>
          <p>
            Open a file and it stays here. Paperbox edits, signs, converts and protects PDFs entirely
            inside this tab — no account, no uploads, and it keeps working with the network off.
          </p>
          <div className="home__pills">
            <span className="pill">
              <Icon name="shield" size={13} /> No uploads
            </span>
            <span className="pill">
              <Icon name="convert" size={13} /> Works offline
            </span>
            <span className="pill">
              <Icon name="layers" size={13} /> Full page management
            </span>
            <span className="pill">
              <Icon name="lock" size={13} /> Passwords &amp; redaction
            </span>
          </div>
        </div>

        <div className={`dropzone ${dragActive ? 'dropzone--active' : ''}`}>
          <h2>{dragActive ? 'Drop to open' : 'Drop a PDF here'}</h2>
          <p>or pick a file from your machine — images work too</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="primary" icon="folder-open" onClick={() => void promptOpenPdf()}>
              Open PDF
            </Button>
            <Button
              variant="outline"
              icon="image"
              onClick={async () => {
                const files = await pickFiles(IMAGE_ACCEPT, true);
                if (files.length > 0) await openImagesAsPdf(files);
              }}
            >
              Images to PDF
            </Button>
            {doc && (
              <Button variant="outline" icon="file" onClick={() => setShowHomeScreen(false)}>
                Back to {doc.name}
              </Button>
            )}
          </div>
        </div>

        <h3 className="sidebar__section-title" style={{ padding: '0 0 8px' }}>
          Quick actions
        </h3>
        <div className="quick-grid">
          {actions.map((action) => (
            <button key={action.id} type="button" className="quick" onClick={() => void action.run()}>
              <span className="quick__icon">
                <Icon name={action.icon} size={17} />
              </span>
              <span className="quick__title">{action.title}</span>
              <span className="quick__desc">{action.description}</span>
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <>
            <h3 className="sidebar__section-title" style={{ padding: '24px 0 8px' }}>
              Recent
            </h3>
            <div className="recent-list">
              {recent.map((entry) => (
                <div key={entry.id} className="recent">
                  {entry.thumbnail ? (
                    <img src={entry.thumbnail} alt="" />
                  ) : (
                    <span className="quick__icon">
                      <Icon name="file" size={16} />
                    </span>
                  )}
                  <span style={{ minWidth: 0 }}>
                    <span className="recent__name">{entry.name}</span>
                    <span className="recent__meta">
                      {entry.pageCount} pages · {formatDate(entry.openedAt)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Recent files are names and preview thumbnails only — the PDFs themselves are never
              copied anywhere. Reopen a file from disk to continue working on it.
            </p>
          </>
        )}

        <div className="home__footer">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => useUiStore.getState().openDialog('privacy')}
          >
            <Icon name="shield" size={13} /> How your files are handled
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => useUiStore.getState().openDialog('shortcuts')}
          >
            Keyboard shortcuts
          </button>
        </div>
      </div>
    </div>
  );
}

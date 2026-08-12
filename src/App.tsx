import { useCallback, useEffect, useState } from 'react';
import { useEditorStore } from './state/editorStore';
import { useUiStore } from './state/uiStore';
import { usePlacementStore } from './state/placementStore';
import {
  useAutosave,
  useFileDrop,
  useKeyboardShortcuts,
  useLiveSearch,
  useTheme,
  useUnloadGuard,
} from './app/hooks';
import { openFiles } from './app/actions';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/sidebar/Sidebar';
import { Viewer } from './components/viewer/Viewer';
import { PropertiesPanel } from './components/PropertiesPanel';
import { StatusBar } from './components/StatusBar';
import { HomeScreen } from './components/HomeScreen';
import { DialogHost } from './components/dialogs';
import { ProgressOverlay, Toasts } from './components/ui/Feedback';
import { Button, Modal, Note } from './components/ui/controls';
import { clearSession, loadSession } from './lib/storage/db';
import type { PersistedSession } from './types/document';
import { formatDate } from './lib/util/misc';

export default function App() {
  const doc = useEditorStore((state) => state.doc);
  const fullscreen = useEditorStore((state) => state.fullscreen);
  const showHome = useUiStore((state) => state.showHomeScreen);
  const setShowHomeScreen = useUiStore((state) => state.setShowHomeScreen);
  const [online, setOnline] = useState(navigator.onLine);
  const [recovery, setRecovery] = useState<PersistedSession | null>(null);

  useTheme();
  useKeyboardShortcuts();
  useUnloadGuard();
  useLiveSearch();
  const savedAt = useAutosave();

  const onFiles = useCallback((files: File[]) => {
    void openFiles(files);
  }, []);
  const dragActive = useFileDrop(onFiles);

  // Offer to restore the previous session after a crash or accidental reload.
  useEffect(() => {
    loadSession()
      .then((session) => {
        if (session && session.document.pages.length > 0) setRecovery(session);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Esc cancels an armed signature/stamp.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') usePlacementStore.getState().setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showHomeScreen = showHome || !doc;

  return (
    <div className={`app ${fullscreen ? 'is-fullscreen' : ''}`}>
      <a className="skip-link" href="#viewer-scroll">
        Skip to document
      </a>

      <TopBar />
      <Toolbar />

      <main className="workspace">
        <Sidebar />
        <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
          <Viewer />
          {showHomeScreen && <HomeScreen dragActive={dragActive} />}
        </div>
        {!showHomeScreen && <PropertiesPanel />}
      </main>

      <StatusBar savedAt={savedAt} online={online} />

      <DialogHost />
      <Toasts />
      <ProgressOverlay />

      {dragActive && !showHomeScreen && (
        <div
          className="progress-overlay"
          style={{ background: 'rgba(47,109,246,0.18)', pointerEvents: 'none' }}
          aria-hidden
        >
          <div className="progress-card" style={{ textAlign: 'center' }}>
            <strong>Drop to add to this document</strong>
            <p className="small muted" style={{ margin: 0 }}>
              PDFs open as a new document · images are placed on the current page
            </p>
          </div>
        </div>
      )}

      {recovery && (
        <Modal
          title="Restore your last session?"
          icon="repair"
          onClose={() => setRecovery(null)}
          footer={
            <>
              <Button
                variant="danger"
                onClick={async () => {
                  await clearSession();
                  setRecovery(null);
                }}
              >
                Discard
              </Button>
              <span className="spacer" />
              <Button onClick={() => setRecovery(null)}>Not now</Button>
              <Button
                variant="primary"
                icon="check"
                onClick={() => {
                  useEditorStore.getState().setDocument(recovery.document, { markClean: true });
                  setShowHomeScreen(false);
                  setRecovery(null);
                }}
              >
                Restore
              </Button>
            </>
          }
        >
          <p>
            <strong>{recovery.document.name}</strong> — {recovery.document.pages.length} pages, saved{' '}
            {formatDate(recovery.savedAt)}.
          </p>
          <Note kind="info">
            Sessions are stored in this browser only, so your work survives a crash without a file
            ever leaving the machine.
          </Note>
        </Modal>
      )}
    </div>
  );
}

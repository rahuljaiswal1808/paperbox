import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { Button } from './ui/controls';
import { Icon } from './ui/Icon';
import { Menu, type MenuItem } from './ui/Menu';
import {
  closeDocument,
  exportDocument,
  extractPages,
  openImagesAsPdf,
  promptOpenPdf,
} from '../app/actions';
import { pickFiles } from '../lib/util/file';
import { IMAGE_ACCEPT } from '../app/actions';

export function TopBar() {
  const doc = useEditorStore((state) => state.doc);
  const dirty = useEditorStore((state) => state.dirty);
  const canUndo = useEditorStore((state) => state.past.length > 0);
  const canRedo = useEditorStore((state) => state.future.length > 0);
  const undoLabel = useEditorStore((state) => state.past.at(-1)?.label);
  const redoLabel = useEditorStore((state) => state.future[0]?.label);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const renameDocument = useEditorStore((state) => state.renameDocument);
  const selectedPages = useEditorStore((state) => state.selectedPageIndexes);
  const currentPage = useEditorStore((state) => state.currentPage);
  const openDialog = useUiStore((state) => state.openDialog);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const setShowHomeScreen = useUiStore((state) => state.setShowHomeScreen);

  const hasDoc = Boolean(doc);
  const pageTargets = selectedPages.length > 0 ? selectedPages : [currentPage];

  const fileItems: MenuItem[] = [
    { id: 'open', label: 'Open PDF…', icon: 'folder-open', shortcut: '⌘O', onSelect: () => void promptOpenPdf() },
    {
      id: 'images',
      label: 'Images to PDF…',
      icon: 'image',
      onSelect: async () => {
        const files = await pickFiles(IMAGE_ACCEPT, true);
        if (files.length > 0) await openImagesAsPdf(files);
      },
    },
    { id: 'insert', label: 'Insert pages from PDF…', icon: 'add-page', disabled: !hasDoc, separatorBefore: true, onSelect: () => openDialog('insert-pages') },
    { id: 'merge', label: 'Merge PDFs…', icon: 'merge', onSelect: () => openDialog('merge') },
    { id: 'split', label: 'Split…', icon: 'split', disabled: !hasDoc, onSelect: () => openDialog('split') },
    { id: 'export', label: 'Export PDF…', icon: 'download', shortcut: '⌘S', disabled: !hasDoc, separatorBefore: true, onSelect: () => openDialog('export') },
    { id: 'compress', label: 'Compress…', icon: 'compress', disabled: !hasDoc, onSelect: () => openDialog('compress') },
    { id: 'images-out', label: 'Export as images…', icon: 'image', disabled: !hasDoc, onSelect: () => openDialog('export-images') },
    { id: 'text-out', label: 'Export as text…', icon: 'text', disabled: !hasDoc, onSelect: () => openDialog('export-text') },
    { id: 'home', label: 'Home screen', icon: 'file', separatorBefore: true, onSelect: () => setShowHomeScreen(true) },
    { id: 'close', label: 'Close document', icon: 'close', disabled: !hasDoc, danger: true, onSelect: () => void closeDocument() },
  ];

  const pageItems: MenuItem[] = [
    { id: 'add', label: 'Insert blank page', icon: 'add-page', onSelect: () => useEditorStore.getState().addBlankPage() },
    { id: 'duplicate', label: 'Duplicate selected', icon: 'copy', onSelect: () => useEditorStore.getState().duplicatePages(pageTargets) },
    { id: 'delete', label: 'Delete selected', icon: 'trash', danger: true, onSelect: () => useEditorStore.getState().deletePages(pageTargets) },
    { id: 'rotate-cw', label: 'Rotate right', icon: 'rotate-cw', separatorBefore: true, onSelect: () => useEditorStore.getState().rotatePages(pageTargets, 90) },
    { id: 'rotate-ccw', label: 'Rotate left', icon: 'rotate-ccw', onSelect: () => useEditorStore.getState().rotatePages(pageTargets, 270) },
    { id: 'crop', label: 'Crop tool', icon: 'crop', onSelect: () => useEditorStore.getState().setTool('crop') },
    { id: 'uncrop', label: 'Remove crop', onSelect: () => useEditorStore.getState().setCrop(pageTargets, undefined) },
    { id: 'extract', label: 'Extract selected pages…', icon: 'download', separatorBefore: true, onSelect: () => void extractPages(pageTargets) },
    { id: 'insert-pdf', label: 'Insert pages from PDF…', icon: 'add-page', onSelect: () => openDialog('insert-pages') },
  ];

  const toolItems: MenuItem[] = [
    { id: 'sign', label: 'Signatures…', icon: 'signature', onSelect: () => openDialog('signature') },
    { id: 'protect', label: 'Password & permissions…', icon: 'lock', onSelect: () => openDialog('protect') },
    { id: 'watermark', label: 'Watermark…', icon: 'image', onSelect: () => openDialog('watermark') },
    { id: 'header', label: 'Header, footer & page numbers…', icon: 'text', onSelect: () => openDialog('header-footer') },
    { id: 'metadata', label: 'Document properties…', icon: 'info', separatorBefore: true, onSelect: () => openDialog('metadata') },
    { id: 'bookmarks', label: 'Bookmarks…', icon: 'bookmark', onSelect: () => openDialog('bookmarks') },
    { id: 'repair', label: 'Repair a PDF…', icon: 'repair', onSelect: () => openDialog('repair') },
    { id: 'ocr', label: 'OCR (make scans searchable)…', icon: 'search', onSelect: () => openDialog('ocr') },
  ];

  const helpItems: MenuItem[] = [
    { id: 'shortcuts', label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => openDialog('shortcuts') },
    { id: 'privacy', label: 'How your files are handled', icon: 'shield', onSelect: () => openDialog('privacy') },
    { id: 'about', label: 'About Paperbox', icon: 'info', onSelect: () => openDialog('about') },
  ];

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Icon name="file" size={19} />
        Paperbox
      </div>

      <Menu label="File" items={fileItems} />
      <Menu label="Pages" items={pageItems} />
      <Menu label="Tools" items={toolItems} />
      <Menu label="Help" items={helpItems} />

      <div className="divider-v" />

      <Button
        icon="undo"
        iconOnly
        aria-label={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
        title={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
        disabled={!canUndo}
        onClick={undo}
      />
      <Button
        icon="redo"
        iconOnly
        aria-label={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
        title={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
        disabled={!canRedo}
        onClick={redo}
      />

      <div className="topbar__title">
        {doc && (
          <>
            <input
              className="topbar__name"
              value={doc.name}
              aria-label="Document name"
              onChange={(event) => renameDocument(event.target.value)}
            />
            {dirty && <span className="dot-dirty" title="Unsaved changes" />}
          </>
        )}
      </div>

      <div className="topbar__spacer" />

      <Button
        icon={theme === 'dark' ? 'sun' : 'moon'}
        iconOnly
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        title="Toggle theme"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      <Button
        icon="download"
        variant="primary"
        disabled={!hasDoc}
        onClick={() => void exportDocument()}
        title="Export the edited PDF (⌘S)"
      >
        Export PDF
      </Button>
    </header>
  );
}

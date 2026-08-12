import { useState } from 'react';
import { useUiStore } from '../../state/uiStore';
import { usePasswordStore } from '../../state/passwordStore';
import { Button, Field, Modal, Note, TextInput } from '../ui/controls';
import { CompressDialog, ExportDialog, ExportImagesDialog, ExportTextDialog } from './ExportDialogs';
import { InsertPagesDialog, MergeDialog, SplitDialog } from './PageDialogs';
import { SignatureDialog } from './SignatureDialog';
import { SecurityDialog } from './SecurityDialog';
import {
  BookmarksDialog,
  HeaderFooterDialog,
  MetadataDialog,
  OcrDialog,
  WatermarkDialog,
} from './DocumentDialogs';
import { AboutDialog, PrivacyDialog, RepairDialog, ShortcutsDialog } from './UtilityDialogs';

export function DialogHost() {
  const dialog = useUiStore((state) => state.dialog);

  return (
    <>
      <PasswordPrompt />
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'compress' && <CompressDialog />}
      {dialog === 'export-images' && <ExportImagesDialog />}
      {dialog === 'export-text' && <ExportTextDialog />}
      {dialog === 'merge' && <MergeDialog />}
      {dialog === 'split' && <SplitDialog />}
      {dialog === 'insert-pages' && <InsertPagesDialog />}
      {dialog === 'signature' && <SignatureDialog />}
      {dialog === 'protect' && <SecurityDialog />}
      {dialog === 'metadata' && <MetadataDialog />}
      {dialog === 'bookmarks' && <BookmarksDialog />}
      {dialog === 'watermark' && <WatermarkDialog />}
      {dialog === 'header-footer' && <HeaderFooterDialog />}
      {dialog === 'ocr' && <OcrDialog />}
      {dialog === 'repair' && <RepairDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'privacy' && <PrivacyDialog />}
      {dialog === 'about' && <AboutDialog />}
    </>
  );
}

function PasswordPrompt() {
  const request = usePasswordStore((state) => state.request);
  const submit = usePasswordStore((state) => state.submit);
  const cancel = usePasswordStore((state) => state.cancel);
  const [password, setPassword] = useState('');

  if (!request) return null;

  return (
    <Modal
      title="This PDF is password protected"
      icon="lock"
      elevated
      onClose={cancel}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={cancel}>Cancel</Button>
          <Button
            variant="primary"
            icon="lock"
            onClick={() => {
              submit(password);
              setPassword('');
            }}
          >
            Unlock
          </Button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        {request.fileName}
      </p>
      {request.wrongPassword && <Note kind="danger">That password did not work. Try again.</Note>}
      <Field label="Password">
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              submit(password);
              setPassword('');
            }}
          />
        )}
      </Field>
      <Note kind="info">The password is used in this tab only, to decrypt the file for editing.</Note>
    </Modal>
  );
}

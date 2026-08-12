import { useState } from 'react';
import { useSecurityStore } from '../../state/securityStore';
import { useUiStore } from '../../state/uiStore';
import { useEditorStore } from '../../state/editorStore';
import { Button, Checkbox, Field, Modal, Note, TextInput } from '../ui/controls';
import { exportDocument } from '../../app/actions';
import { sanitizeFilename } from '../../lib/util/misc';

const PERMISSIONS: { key: keyof ReturnType<typeof useSecurityStore.getState>['permissions']; label: string; hint?: string }[] = [
  { key: 'printing', label: 'Printing' },
  { key: 'highQualityPrinting', label: 'High-resolution printing' },
  { key: 'copying', label: 'Copying text and graphics' },
  { key: 'modifying', label: 'Changing the document' },
  { key: 'annotating', label: 'Adding comments and annotations' },
  { key: 'fillingForms', label: 'Filling in form fields' },
  { key: 'documentAssembly', label: 'Inserting, rotating or deleting pages' },
  { key: 'contentAccessibility', label: 'Screen-reader text extraction', hint: 'Leave on unless you have a specific reason.' },
];

export function SecurityDialog() {
  const close = useUiStore((state) => state.closeDialog);
  const doc = useEditorStore((state) => state.doc);
  const security = useSecurityStore();
  const [confirm, setConfirm] = useState(security.userPassword ?? '');

  const mismatch = Boolean(security.userPassword) && confirm !== security.userPassword;

  return (
    <Modal
      title="Password & permissions"
      icon="lock"
      onClose={close}
      description="Encryption is applied when the PDF is written, on this machine."
      footer={
        <>
          <Button
            onClick={() => {
              security.clear();
              setConfirm('');
            }}
          >
            Remove protection
          </Button>
          <span className="spacer" />
          <Button onClick={close}>Done</Button>
          <Button
            variant="primary"
            icon="download"
            disabled={!doc || mismatch || (security.enabled && !security.userPassword && !security.ownerPassword)}
            onClick={async () => {
              close();
              await exportDocument({
                filename: `${sanitizeFilename(doc?.name ?? 'document')}-protected.pdf`,
                successTitle: 'Protected PDF saved',
              });
            }}
          >
            Save protected copy
          </Button>
        </>
      }
    >
      <Checkbox
        checked={security.enabled}
        onChange={(value) => security.set({ enabled: value })}
        label="Encrypt this PDF with a password"
      />

      {security.enabled && (
        <>
          <div className="field-row" style={{ marginTop: 10 }}>
            <Field label="Open password (user)" hint="Required to open the document.">
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={security.userPassword ?? ''}
                  onChange={(event) => security.set({ userPassword: event.target.value })}
                />
              )}
            </Field>
            <Field label="Confirm">
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  className={mismatch ? 'input--invalid' : ''}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              )}
            </Field>
          </div>
          {mismatch && <Note kind="danger">The two passwords do not match.</Note>}

          <Field
            label="Permissions password (owner)"
            hint="Optional. Lets someone change the restrictions below. Defaults to the open password."
          >
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={security.ownerPassword ?? ''}
                onChange={(event) => security.set({ ownerPassword: event.target.value })}
              />
            )}
          </Field>

          <div className="panel__title" style={{ marginTop: 14 }}>
            Allowed without the owner password
          </div>
          {PERMISSIONS.map((permission) => (
            <Checkbox
              key={permission.key}
              checked={security.permissions[permission.key]}
              onChange={(value) => security.setPermission(permission.key, value)}
              label={
                <>
                  {permission.label}
                  {permission.hint && <span className="small muted"> — {permission.hint}</span>}
                </>
              }
            />
          ))}

          <Note kind="warning">
            Permission flags are honoured by well-behaved readers but are not a security boundary —
            only the open password actually encrypts the content. There is no way to recover a lost
            password, so store it somewhere safe.
          </Note>
        </>
      )}

      {!security.enabled && (
        <Note kind="info">
          With protection off, exports are written as ordinary unencrypted PDFs.
        </Note>
      )}
    </Modal>
  );
}

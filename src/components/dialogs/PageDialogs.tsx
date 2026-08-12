import { useMemo, useState } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useUiStore, withProgress } from '../../state/uiStore';
import { Button, Checkbox, Field, Modal, Note, Select, TextInput } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { PDF_ACCEPT, openPdfFiles, splitDocument, type SplitPart } from '../../app/actions';
import { pickFiles, readFileBytes } from '../../lib/util/file';
import { formatBytes, formatPageList, parsePageRanges, sanitizeFilename, uid } from '../../lib/util/misc';
import { inspectPdf } from '../../lib/ops/documentFactory';

export function MergeDialog() {
  const close = useUiStore((state) => state.closeDialog);
  const doc = useEditorStore((state) => state.doc);
  const [files, setFiles] = useState<File[]>([]);
  const [appendToCurrent, setAppendToCurrent] = useState(false);

  const add = async () => {
    const picked = await pickFiles(PDF_ACCEPT, true);
    setFiles((current) => [...current, ...picked]);
  };

  const move = (index: number, delta: number) => {
    setFiles((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const run = async () => {
    if (files.length === 0) return;
    if (appendToCurrent && doc) {
      await withProgress(
        'Appending files',
        async (report) => {
          for (let i = 0; i < files.length; i += 1) {
            report(i / files.length, files[i].name);
            const bytes = await readFileBytes(files[i]);
            const { sourceId, pages } = await inspectPdf(bytes);
            useEditorStore.getState().update(
              (current) => ({
                ...current,
                sources: { ...current.sources, [sourceId]: { id: sourceId, name: files[i].name, bytes } },
                pages: [...current.pages, ...pages],
              }),
              `Append ${files[i].name}`,
            );
          }
          return true;
        },
        { successTitle: 'Files appended', errorTitle: 'Could not append these files' },
      );
      close();
      return;
    }
    close();
    await openPdfFiles(files);
  };

  return (
    <Modal
      title="Merge PDFs"
      icon="merge"
      onClose={close}
      description="Files are combined in the order shown. Everything happens on this machine."
      footer={
        <>
          <Button icon="plus" onClick={() => void add()}>
            Add files
          </Button>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon="merge" disabled={files.length === 0} onClick={() => void run()}>
            Merge {files.length > 0 ? files.length : ''}
          </Button>
        </>
      }
    >
      {files.length === 0 ? (
        <div className="empty">
          <Icon name="merge" size={22} />
          <p>Add two or more PDFs to combine them.</p>
          <Button variant="outline" icon="plus" onClick={() => void add()}>
            Choose files
          </Button>
        </div>
      ) : (
        <div className="file-list">
          {files.map((file, index) => (
            <div className="file-row" key={`${file.name}-${index}`}>
              <Icon name="file" size={15} />
              <span className="file-row__name">{file.name}</span>
              <span className="file-row__meta">{formatBytes(file.size)}</span>
              <Button icon="arrow-up" iconOnly size="sm" aria-label="Move up" onClick={() => move(index, -1)} />
              <Button icon="arrow-down" iconOnly size="sm" aria-label="Move down" onClick={() => move(index, 1)} />
              <Button
                icon="close"
                iconOnly
                size="sm"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              />
            </div>
          ))}
        </div>
      )}

      {doc && (
        <Checkbox
          checked={appendToCurrent}
          onChange={setAppendToCurrent}
          label={`Append to the open document instead (${doc.name})`}
        />
      )}
    </Modal>
  );
}

type SplitMode = 'every' | 'ranges' | 'selection' | 'single';

export function SplitDialog() {
  const doc = useEditorStore((state) => state.doc);
  const selected = useEditorStore((state) => state.selectedPageIndexes);
  const close = useUiStore((state) => state.closeDialog);
  const [mode, setMode] = useState<SplitMode>(selected.length > 1 ? 'selection' : 'every');
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState('1-2, 3-end');
  const [zip, setZip] = useState(true);

  const count = doc?.pages.length ?? 0;

  const parts: SplitPart[] = useMemo(() => {
    if (!doc) return [];
    const base = sanitizeFilename(doc.name);
    switch (mode) {
      case 'single':
        return doc.pages.map((_, i) => ({ name: `${base}-p${i + 1}`, pages: [i] }));
      case 'selection':
        return selected.length > 0
          ? [{ name: `${base}-selection`, pages: [...selected].sort((a, b) => a - b) }]
          : [];
      case 'ranges':
        return ranges
          .split(',')
          .map((chunk) => chunk.trim())
          .filter(Boolean)
          .map((chunk, i) => ({ name: `${base}-${i + 1}`, pages: parsePageRanges(chunk, count) }))
          .filter((part) => part.pages.length > 0);
      default: {
        const size = Math.max(1, every);
        const out: SplitPart[] = [];
        for (let start = 0; start < count; start += size) {
          const pages = Array.from({ length: Math.min(size, count - start) }, (_, i) => start + i);
          out.push({ name: `${base}-${out.length + 1}`, pages });
        }
        return out;
      }
    }
  }, [doc, mode, every, ranges, selected, count]);

  return (
    <Modal
      title="Split PDF"
      icon="split"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            icon="split"
            disabled={parts.length === 0}
            onClick={async () => {
              close();
              await splitDocument(parts, zip);
            }}
          >
            Create {parts.length} file{parts.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="chips" style={{ marginBottom: 12 }}>
        {(
          [
            ['every', 'Every N pages'],
            ['ranges', 'Custom ranges'],
            ['selection', `Selected pages (${selected.length})`],
            ['single', 'One file per page'],
          ] as [SplitMode, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`chip ${mode === value ? 'chip--active' : ''}`}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'every' && (
        <Field label="Pages per file">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={Math.max(1, count)}
              value={every}
              onChange={(event) => setEvery(Number(event.target.value))}
            />
          )}
        </Field>
      )}

      {mode === 'ranges' && (
        <Field label="Ranges" hint="Comma separated. Each range becomes its own file — e.g. 1-2, 3-end">
          {(id) => <TextInput id={id} value={ranges} onChange={(event) => setRanges(event.target.value)} />}
        </Field>
      )}

      <Checkbox checked={zip} onChange={setZip} label="Download as a single .zip" />

      <div className="panel__title" style={{ marginTop: 14 }}>
        Result
      </div>
      <div className="file-list">
        {parts.slice(0, 12).map((part) => (
          <div className="file-row" key={part.name}>
            <Icon name="file" size={14} />
            <span className="file-row__name">{part.name}.pdf</span>
            <span className="file-row__meta">{formatPageList(part.pages)}</span>
          </div>
        ))}
        {parts.length > 12 && <div className="small muted">…and {parts.length - 12} more</div>}
        {parts.length === 0 && <div className="empty">Nothing to split with these settings.</div>}
      </div>
    </Modal>
  );
}

export function InsertPagesDialog() {
  const doc = useEditorStore((state) => state.doc);
  const currentPage = useEditorStore((state) => state.currentPage);
  const close = useUiStore((state) => state.closeDialog);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<Awaited<ReturnType<typeof inspectPdf>> | null>(null);
  const [range, setRange] = useState('1-end');
  const [position, setPosition] = useState<'before' | 'after' | 'start' | 'end'>('after');

  const choose = async () => {
    const [picked] = await pickFiles(PDF_ACCEPT, false);
    if (!picked) return;
    setFile(picked);
    await withProgress(
      `Reading ${picked.name}`,
      async () => {
        const bytes = await readFileBytes(picked);
        setSource(await inspectPdf(bytes));
        return true;
      },
      { errorTitle: 'Could not read this PDF' },
    );
  };

  const pages = source?.pages ?? [];
  const chosen = parsePageRanges(range, pages.length);

  const run = () => {
    if (!doc || !source || !file || chosen.length === 0) return;
    const at =
      position === 'start'
        ? 0
        : position === 'end'
          ? doc.pages.length
          : position === 'before'
            ? currentPage
            : currentPage + 1;

    const inserted = chosen.map((index) => ({ ...pages[index], id: uid('pg') }));
    useEditorStore.getState().update(
      (current) => {
        const next = [...current.pages];
        next.splice(at, 0, ...inserted);
        return {
          ...current,
          sources: {
            ...current.sources,
            [source.sourceId]: { id: source.sourceId, name: file.name, bytes: source.bytes },
          },
          pages: next,
        };
      },
      `Insert ${inserted.length} page${inserted.length === 1 ? '' : 's'}`,
    );
    useEditorStore.getState().setCurrentPage(at);
    close();
  };

  return (
    <Modal
      title="Insert pages from another PDF"
      icon="add-page"
      onClose={close}
      footer={
        <>
          <Button icon="folder-open" onClick={() => void choose()}>
            Choose file
          </Button>
          <span className="spacer" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon="add-page" disabled={chosen.length === 0} onClick={run}>
            Insert {chosen.length} page{chosen.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {!file ? (
        <div className="empty">
          <Icon name="add-page" size={22} />
          <p>Pick the PDF you want to take pages from.</p>
          <Button variant="outline" icon="folder-open" onClick={() => void choose()}>
            Choose file
          </Button>
        </div>
      ) : (
        <>
          <div className="file-row" style={{ marginBottom: 12 }}>
            <Icon name="file" size={15} />
            <span className="file-row__name">{file.name}</span>
            <span className="file-row__meta">{pages.length} pages</span>
          </div>
          <Field label="Pages to insert" hint="For example 1-3, 8, 10-end">
            {(id) => <TextInput id={id} value={range} onChange={(event) => setRange(event.target.value)} />}
          </Field>
          <Field label="Where">
            {(id) => (
              <Select
                id={id}
                value={position}
                onChange={(event) => setPosition(event.target.value as typeof position)}
              >
                <option value="after">After the current page ({currentPage + 1})</option>
                <option value="before">Before the current page ({currentPage + 1})</option>
                <option value="start">At the beginning</option>
                <option value="end">At the end</option>
              </Select>
            )}
          </Field>
          <Note kind="info">
            The pages keep their original content and are copied into your document when you export.
          </Note>
        </>
      )}
    </Modal>
  );
}

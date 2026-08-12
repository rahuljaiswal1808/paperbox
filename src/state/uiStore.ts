import { create } from 'zustand';
import { uid } from '../lib/util/misc';

export type DialogId =
  | 'merge'
  | 'split'
  | 'compress'
  | 'export-images'
  | 'export-text'
  | 'images-to-pdf'
  | 'signature'
  | 'protect'
  | 'metadata'
  | 'watermark'
  | 'header-footer'
  | 'bookmarks'
  | 'insert-pages'
  | 'export'
  | 'repair'
  | 'ocr'
  | 'shortcuts'
  | 'about'
  | 'privacy';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  /** Extra lines shown under the message, e.g. export warnings. */
  notes?: string[];
  timeout?: number;
}

export interface ProgressState {
  label: string;
  fraction: number | null;
  cancel?: () => void;
}

export type ThemeMode = 'system' | 'light' | 'dark';

interface UiState {
  dialog: DialogId | null;
  dialogPayload: unknown;
  toasts: Toast[];
  progress: ProgressState | null;
  theme: ThemeMode;
  showHomeScreen: boolean;

  openDialog: (id: DialogId, payload?: unknown) => void;
  closeDialog: () => void;
  toast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  setProgress: (progress: ProgressState | null) => void;
  updateProgress: (fraction: number, label?: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setShowHomeScreen: (value: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  dialog: null,
  dialogPayload: null,
  toasts: [],
  progress: null,
  theme: 'system',
  showHomeScreen: true,

  openDialog: (id, payload) => set({ dialog: id, dialogPayload: payload ?? null }),
  closeDialog: () => set({ dialog: null, dialogPayload: null }),

  toast: (toast) => {
    const id = uid('toast');
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    const timeout = toast.timeout ?? (toast.kind === 'error' ? 12_000 : 5_000);
    if (timeout > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, timeout);
    }
    return id;
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  setProgress: (progress) => set({ progress }),
  updateProgress: (fraction, label) =>
    set((state) =>
      state.progress
        ? { progress: { ...state.progress, fraction, label: label ?? state.progress.label } }
        : state,
    ),

  setTheme: (theme) => set({ theme }),
  setShowHomeScreen: (value) => set({ showHomeScreen: value }),
}));

/** Convenience wrapper: run a long job with a progress bar and error toast. */
export async function withProgress<T>(
  label: string,
  job: (report: (fraction: number, label?: string) => void, signal: AbortSignal) => Promise<T>,
  options: { successTitle?: string; errorTitle?: string } = {},
): Promise<T | null> {
  const ui = useUiStore.getState();
  const controller = new AbortController();
  ui.setProgress({ label, fraction: 0, cancel: () => controller.abort() });
  try {
    const result = await job(
      (fraction, nextLabel) => useUiStore.getState().updateProgress(fraction, nextLabel),
      controller.signal,
    );
    if (options.successTitle) ui.toast({ kind: 'success', title: options.successTitle });
    return result;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      ui.toast({ kind: 'info', title: 'Cancelled' });
      return null;
    }
    ui.toast({
      kind: 'error',
      title: options.errorTitle ?? 'Something went wrong',
      detail: (error as Error).message,
    });
    return null;
  } finally {
    useUiStore.getState().setProgress(null);
  }
}

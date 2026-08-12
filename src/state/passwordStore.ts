import { create } from 'zustand';

interface PasswordRequest {
  fileName: string;
  wrongPassword: boolean;
  resolve: (password: string | null) => void;
}

interface PasswordState {
  request: PasswordRequest | null;
  ask: (fileName: string, wrongPassword: boolean) => Promise<string | null>;
  submit: (password: string) => void;
  cancel: () => void;
}

/**
 * Encrypted PDFs need a password before pdf.js will open them. The prompt is a
 * promise so the file-opening code reads top to bottom.
 */
export const usePasswordStore = create<PasswordState>()((set, get) => ({
  request: null,
  ask: (fileName, wrongPassword) =>
    new Promise<string | null>((resolve) => {
      set({ request: { fileName, wrongPassword, resolve } });
    }),
  submit: (password) => {
    get().request?.resolve(password);
    set({ request: null });
  },
  cancel: () => {
    get().request?.resolve(null);
    set({ request: null });
  },
}));

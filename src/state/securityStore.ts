import { create } from 'zustand';
import type { SecuritySettings } from '../lib/pdf/export';

interface SecurityState extends SecuritySettings {
  enabled: boolean;
  set: (patch: Partial<SecurityState>) => void;
  setPermission: (key: keyof SecuritySettings['permissions'], value: boolean) => void;
  clear: () => void;
  /** The settings to hand to the exporter, or null when protection is off. */
  forExport: () => SecuritySettings | null;
}

const defaults = {
  enabled: false,
  userPassword: '',
  ownerPassword: '',
  permissions: {
    printing: true,
    highQualityPrinting: true,
    modifying: false,
    copying: false,
    annotating: true,
    fillingForms: true,
    contentAccessibility: true,
    documentAssembly: false,
  },
};

/**
 * Encryption settings live outside the document model: they describe how the
 * file is written, not what is in it, and they must never be autosaved to disk.
 */
export const useSecurityStore = create<SecurityState>()((set, get) => ({
  ...defaults,
  set: (patch) => set(patch),
  setPermission: (key, value) =>
    set((state) => ({ permissions: { ...state.permissions, [key]: value } })),
  clear: () => set(defaults),
  forExport: () => {
    const state = get();
    if (!state.enabled || (!state.userPassword && !state.ownerPassword)) return null;
    return {
      userPassword: state.userPassword,
      ownerPassword: state.ownerPassword,
      permissions: state.permissions,
    };
  },
}));

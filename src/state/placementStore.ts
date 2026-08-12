import { create } from 'zustand';

export interface PendingPlacement {
  kind: 'signature' | 'image';
  assetId: string;
  /** width / height of the source bitmap. */
  aspect: number;
  /** Default width in points when dropped onto a page. */
  width: number;
  label: string;
}

interface PlacementState {
  pending: PendingPlacement | null;
  setPending: (placement: PendingPlacement | null) => void;
}

/**
 * Holds the "armed" stamp (a signature or image) waiting to be clicked onto a
 * page, so the signature dialog can hand off to the viewer.
 */
export const usePlacementStore = create<PlacementState>()((set) => ({
  pending: null,
  setPending: (placement) => set({ pending: placement }),
}));

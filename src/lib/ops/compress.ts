/**
 * Compression presets.
 *
 * "Lossless" only rewrites the file structure (object streams, no duplicated
 * resources). The heavier levels re-render each page at a fixed DPI and store
 * it as JPEG — big wins on scans, at the cost of live text.
 */
import type { BuildOptions } from '../pdf/export';

export type CompressionLevel = 'lossless' | 'balanced' | 'strong' | 'extreme';

export interface CompressionPreset {
  id: CompressionLevel;
  label: string;
  description: string;
  keepsText: boolean;
  options: Pick<
    BuildOptions,
    'rasterizeAll' | 'rasterDpi' | 'rasterQuality' | 'rasterFormat' | 'useObjectStreams'
  >;
}

export const COMPRESSION_PRESETS: CompressionPreset[] = [
  {
    id: 'lossless',
    label: 'Lossless',
    description: 'Rewrites the file structure only. Text, vectors and image quality are untouched.',
    keepsText: true,
    options: { useObjectStreams: true },
  },
  {
    id: 'balanced',
    label: 'Balanced · 150 DPI',
    description: 'Re-renders pages at print-ready 150 DPI. Good for scans and image-heavy files.',
    keepsText: false,
    options: { rasterizeAll: true, rasterDpi: 150, rasterQuality: 0.82, rasterFormat: 'jpeg', useObjectStreams: true },
  },
  {
    id: 'strong',
    label: 'Strong · 110 DPI',
    description: 'Smaller files, still readable on screen and in ordinary printing.',
    keepsText: false,
    options: { rasterizeAll: true, rasterDpi: 110, rasterQuality: 0.7, rasterFormat: 'jpeg', useObjectStreams: true },
  },
  {
    id: 'extreme',
    label: 'Extreme · 72 DPI',
    description: 'Screen-only quality. Use when a file has to fit an upload limit.',
    keepsText: false,
    options: { rasterizeAll: true, rasterDpi: 72, rasterQuality: 0.55, rasterFormat: 'jpeg', useObjectStreams: true },
  },
];

export const presetById = (id: CompressionLevel): CompressionPreset =>
  COMPRESSION_PRESETS.find((p) => p.id === id) ?? COMPRESSION_PRESETS[0];

export const compressionSummary = (before: number, after: number): string => {
  if (!before) return 'Compressed.';
  if (after >= before) {
    // Rasterising a text-only PDF usually costs more than it saves; say so
    // rather than leaving the user staring at a bigger file.
    return 'This level made the file larger — its pages are mostly text, so try Lossless instead.';
  }
  const saved = Math.round((1 - after / before) * 100);
  return `${saved}% smaller`;
};

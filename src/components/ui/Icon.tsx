/**
 * A small stroke-icon set (24×24, 1.7px strokes) so the UI has no icon-font or
 * external SVG dependency — important for a fully offline app.
 */
export type IconName =
  | 'add-page'
  | 'alert'
  | 'arrow-down'
  | 'arrow-up'
  | 'bookmark'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'close'
  | 'compress'
  | 'convert'
  | 'copy'
  | 'crop'
  | 'cursor'
  | 'download'
  | 'ellipse'
  | 'expand'
  | 'eye-off'
  | 'file'
  | 'file-plus'
  | 'folder-open'
  | 'form'
  | 'hand'
  | 'highlight'
  | 'image'
  | 'info'
  | 'layers'
  | 'line'
  | 'list'
  | 'lock'
  | 'merge'
  | 'moon'
  | 'note'
  | 'pen'
  | 'plus'
  | 'redo'
  | 'repair'
  | 'rotate-ccw'
  | 'rotate-cw'
  | 'search'
  | 'settings'
  | 'shapes'
  | 'shield'
  | 'signature'
  | 'split'
  | 'square'
  | 'strikethrough'
  | 'sun'
  | 'text'
  | 'trash'
  | 'underline'
  | 'undo'
  | 'zoom-in'
  | 'zoom-out';

const PATHS: Record<IconName, string> = {
  'add-page': 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6',
  alert: 'M12 3 2 20h20zM12 9v5M12 17.5v.5',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  check: 'M4 12.5 9.5 18 20 6.5',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-up': 'M6 15l6-6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  compress: 'M4 4h16M4 20h16M9 9l3-3 3 3M9 15l3 3 3-3M12 6v12',
  convert: 'M4 8h13l-3-3M20 16H7l3 3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  cursor: 'M5 3l7 17 2.5-6.5L21 11z',
  download: 'M12 3v12M7 11l5 5 5-5M4 20h16',
  ellipse: 'M12 6c4.5 0 8 2.7 8 6s-3.5 6-8 6-8-2.7-8-6 3.5-6 8-6z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  'eye-off': 'M3 3l18 18M10.6 6.3A9.7 9.7 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3.1 3.7M6.6 8.3C4.2 9.9 3 12 3 12s4 6 9 6a9.4 9.4 0 0 0 3.4-.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  file: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM13 3v6h6',
  'file-plus': 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM13 3v6h6M12 12v6M9 15h6',
  'folder-open': 'M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 7v11a1 1 0 0 0 1 1h14.2a1 1 0 0 0 1-.7L22 10H6.5a1 1 0 0 0-1 .7z',
  form: 'M4 5h16v14H4zM8 10h8M8 14h5',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5.5a1.5 1.5 0 0 1 3 0V11m0-.5v-2a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-2a1.5 1.5 0 0 1 3 0v1',
  highlight: 'M4 20h6M14 4l6 6-8 8H8l-2-4z',
  image: 'M4 5h16v14H4zM8.5 10.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM4 16l4.5-4.5 4 4L16 12l4 4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5v.5',
  layers: 'M4 8h5V4h6v4h5v12H4zM9 8v12M15 8v12',
  line: 'M5 19L19 5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  merge: 'M7 4v6a4 4 0 0 0 4 4h6M17 4v16M17 14l3-3M17 14l-3-3',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  note: 'M5 4h14v10l-5 5H5zM19 14h-5v5',
  pen: 'M4 20l4-1 10-10a2.1 2.1 0 0 0-3-3L5 16z',
  plus: 'M12 5v14M5 12h14',
  redo: 'M20 10h-9a5 5 0 0 0 0 10h5M20 10l-4-4M20 10l-4 4',
  repair: 'M14.5 4.5a4.5 4.5 0 0 0-6 6L4 15v5h5l4.5-4.5a4.5 4.5 0 0 0 6-6L17 12l-3-1-1-3z',
  'rotate-ccw': 'M4 5v5h5M4.5 10a8 8 0 1 1 .7 6',
  'rotate-cw': 'M20 5v5h-5M19.5 10a8 8 0 1 0-.7 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shapes: 'M4 13h7v7H4zM14.5 4l5 8h-10z',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6z',
  signature: 'M3 17c3 0 3-9 6-9s2 9 5 9 4-4 7-4M4 21h16',
  split: 'M6 4v6a4 4 0 0 0 4 4h8M6 20v-6M18 14l3-3M18 14l-3-3',
  square: 'M4 5h16v14H4z',
  strikethrough: 'M5 12h14M8 8a3.5 3.5 0 0 1 3.5-3h1A3.5 3.5 0 0 1 16 8M8 16a3.5 3.5 0 0 0 3.5 3h1a3.5 3.5 0 0 0 3.5-3',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
  undo: 'M4 10h9a5 5 0 0 1 0 10H8M4 10l4-4M4 10l4 4',
  'zoom-in': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8v6M8 11h6',
  'zoom-out': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6',
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

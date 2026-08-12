export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()` into 0..1 channels. */
export function parseColor(input: string): Rgb & { a: number } {
  const value = input.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = hex.length === 3 || hex.length === 4;
    const part = (i: number) => {
      const chunk = expand ? hex[i].repeat(2) : hex.slice(i * 2, i * 2 + 2);
      return parseInt(chunk, 16) / 255;
    };
    return {
      r: part(0),
      g: part(1),
      b: part(2),
      a: hex.length === 4 || hex.length === 8 ? part(3) : 1,
    };
  }
  const m = /rgba?\(([^)]+)\)/i.exec(value);
  if (m) {
    const [r = 0, g = 0, b = 0, a = 1] = m[1].split(',').map((n) => Number(n.trim()));
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export const withAlpha = (hex: string, alpha: number): string => {
  const { r, g, b } = parseColor(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
};

export const SWATCHES = [
  '#111827',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
];

export const HIGHLIGHT_SWATCHES = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];

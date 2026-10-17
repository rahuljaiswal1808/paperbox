import type { TextStyle } from '../../types/document';

export interface LaidOutLine {
  text: string;
  width: number;
  /** Offset from the box's left edge, honouring alignment. */
  x: number;
  /** Baseline offset from the box's top edge. */
  baseline: number;
}

export interface Measurer {
  (text: string, size: number): number;
}

/**
 * Greedy word wrap shared by the on-screen renderer and the PDF writer, so what
 * the user sees while typing is what lands in the exported file.
 */
export function layoutText(
  text: string,
  style: TextStyle,
  boxWidth: number,
  measure: Measurer,
  /** Distance from the box top to the first baseline; defaults to 0.8em. */
  firstBaseline?: number,
): LaidOutLine[] {
  const lineHeight = style.size * style.lineHeight;
  const lines: { text: string; width: number }[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push({ text: '', width: 0 });
      continue;
    }
    const words = paragraph.split(/(\s+)/).filter((w) => w !== '');
    let current = '';
    for (const word of words) {
      const candidate = current + word;
      const width = measure(candidate, style.size);
      if (width > boxWidth && current.trim() !== '') {
        lines.push({ text: current.replace(/\s+$/, ''), width: measure(current.replace(/\s+$/, ''), style.size) });
        current = word.replace(/^\s+/, '');
      } else {
        current = candidate;
      }
    }
    lines.push({ text: current, width: measure(current, style.size) });
  }

  return lines.map((line, index) => {
    let x = 0;
    if (style.align === 'center') x = (boxWidth - line.width) / 2;
    else if (style.align === 'right') x = boxWidth - line.width;
    return {
      text: line.text,
      width: line.width,
      x,
      // Baseline sits at ~80% of the em box by default, matching canvas'
      // alphabetic baseline; callers replacing existing text pass the exact one.
      baseline: index * lineHeight + (firstBaseline ?? style.size * 0.8),
    };
  });
}

export const textBlockHeight = (lines: number, style: TextStyle): number =>
  Math.max(style.size * style.lineHeight, lines * style.size * style.lineHeight);

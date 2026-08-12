import { StandardFonts } from '@cantoo/pdf-lib';
import type { FontFamily } from '../../types/document';

export const FONT_FAMILIES: { id: FontFamily; label: string; css: string }[] = [
  { id: 'Helvetica', label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { id: 'Times', label: 'Times', css: '"Times New Roman", Times, serif' },
  { id: 'Courier', label: 'Courier', css: '"Courier New", Courier, monospace' },
];

export const cssFontFamily = (family: FontFamily): string =>
  FONT_FAMILIES.find((f) => f.id === family)?.css ?? FONT_FAMILIES[0].css;

/** Map an editor font to one of the 14 standard PDF fonts. */
export function standardFontFor(family: FontFamily, bold: boolean, italic: boolean): StandardFonts {
  switch (family) {
    case 'Times':
      if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
      if (bold) return StandardFonts.TimesRomanBold;
      if (italic) return StandardFonts.TimesRomanItalic;
      return StandardFonts.TimesRoman;
    case 'Courier':
      if (bold && italic) return StandardFonts.CourierBoldOblique;
      if (bold) return StandardFonts.CourierBold;
      if (italic) return StandardFonts.CourierOblique;
      return StandardFonts.Courier;
    default:
      if (bold && italic) return StandardFonts.HelveticaBoldOblique;
      if (bold) return StandardFonts.HelveticaBold;
      if (italic) return StandardFonts.HelveticaOblique;
      return StandardFonts.Helvetica;
  }
}

const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[‐‑‒–—―]/g, '-'],
  [/…/g, '...'],
  [/[     ]/g, ' '],
  [/[•●▪]/g, '-'],
  [/™/g, '(TM)'],
  [/€/g, 'EUR'],
  [/[​-‍﻿]/g, ''],
];

/**
 * The 14 standard fonts only cover WinAnsi. Rather than failing an export we
 * fold the common typographic characters down and flag anything left over, so
 * the UI can warn instead of losing the document.
 */
export function sanitizeForStandardFont(text: string): { text: string; dropped: string[] } {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  const dropped = new Set<string>();
  out = [...out]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
      if (code < 32) return '';
      if (code > 255) {
        dropped.add(ch);
        return '?';
      }
      return ch;
    })
    .join('');
  return { text: out, dropped: [...dropped] };
}

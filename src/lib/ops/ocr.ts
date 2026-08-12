/**
 * OCR extension point.
 *
 * OCR is not bundled: a recognition engine plus its language data is tens of
 * megabytes, which would undermine the "small, instant, offline" promise for
 * everyone who never scans anything. Instead the app defines the contract here
 * and loads an engine at runtime if one has been installed alongside it.
 *
 * To add an engine, register it before the app mounts, e.g.
 *
 *   registerOcrEngine({
 *     id: 'tesseract',
 *     languages: [{ code: 'eng', label: 'English' }],
 *     async recognize(image, { language, onProgress }) { ... },
 *   });
 *
 * The rest of the app (see `OcrDialog`) then lights up automatically. The
 * `OcrResult` shape is deliberately word-level so a future implementation can
 * write a real invisible text layer (text render mode 3) behind the page image
 * rather than dumping a text blob.
 */

export interface OcrLanguage {
  code: string;
  label: string;
}

export interface OcrWord {
  text: string;
  /** Pixel-space box in the image that was passed in. */
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

export interface OcrRequest {
  language: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface OcrEngine {
  id: string;
  label?: string;
  languages: OcrLanguage[];
  recognize(image: Blob, request: OcrRequest): Promise<OcrResult>;
}

let engine: OcrEngine | null = null;

export const registerOcrEngine = (next: OcrEngine): void => {
  engine = next;
};

export const getOcrEngine = (): OcrEngine | null => engine;

export const isOcrAvailable = (): boolean => engine !== null;

/** English first; the contract is already multilingual for later engines. */
export const DEFAULT_OCR_LANGUAGES: OcrLanguage[] = [{ code: 'eng', label: 'English' }];

declare global {
  interface Window {
    paperboxRegisterOcrEngine?: typeof registerOcrEngine;
  }
}

if (typeof window !== 'undefined') {
  window.paperboxRegisterOcrEngine = registerOcrEngine;
}

export const uid = (prefix = 'o'): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "1,3,5-9" -> [0,2,4,5,6,7,8] (zero-based, clamped to `count`). */
export function parsePageRanges(input: string, count: number): number[] {
  const out = new Set<number>();
  for (const chunk of input.split(/[,\s]+/)) {
    if (!chunk) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+|end))?$/i.exec(chunk.trim());
    if (!m) continue;
    const start = Number(m[1]);
    const end = m[2] ? (m[2].toLowerCase() === 'end' ? count : Number(m[2])) : start;
    const lo = Math.max(1, Math.min(start, end));
    const hi = Math.min(count, Math.max(start, end));
    for (let i = lo; i <= hi; i += 1) out.add(i - 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** [0,1,2,4] -> "1-3, 5" for display. */
export function formatPageList(indexes: number[]): string {
  if (indexes.length === 0) return '—';
  const sorted = [...indexes].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i += 1) {
    const cur = sorted[i];
    if (cur !== prev + 1) {
      parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
      start = cur;
    }
    prev = cur;
  }
  return parts.join(', ');
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => timer && clearTimeout(timer);
  return wrapped;
}

/** Lets the browser paint between chunks of a long synchronous job. */
export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

export const sanitizeFilename = (name: string): string =>
  name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'document';

export const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '');

export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

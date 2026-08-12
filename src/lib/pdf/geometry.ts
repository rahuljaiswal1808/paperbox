/**
 * Coordinate maths between the editor's display space and PDF user space.
 *
 * Display space: origin top-left of the page as displayed, y down, PDF points.
 * PDF space:     origin bottom-left of the *unrotated* media box, y up.
 *
 * The two are related by the page's /Rotate value. The mappings below match
 * pdf.js's `PageViewport` transform at scale 1, so what the user sees on the
 * canvas and what we write into the file agree exactly.
 */
import type { PageObject, PageState, Point, Rect, Rotation } from '../../types/document';

export const normalizeRotation = (deg: number): Rotation =>
  (((deg % 360) + 360) % 360) as Rotation;

/** Size of the page's media box, i.e. display size with rotation undone. */
export function unrotatedSize(page: Pick<PageState, 'width' | 'height' | 'rotation'>) {
  return page.rotation === 90 || page.rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/** Map a display-space point onto PDF user space for a page. */
export function displayToPdf(
  page: Pick<PageState, 'width' | 'height' | 'rotation'>,
  p: Point,
): Point {
  const { width: W, height: H } = unrotatedSize(page);
  switch (page.rotation) {
    case 90:
      return { x: p.y, y: p.x };
    case 180:
      return { x: W - p.x, y: p.y };
    case 270:
      return { x: W - p.y, y: H - p.x };
    default:
      return { x: p.x, y: H - p.y };
  }
}

/** Map a PDF-space point back into display space. */
export function pdfToDisplay(
  page: Pick<PageState, 'width' | 'height' | 'rotation'>,
  p: Point,
): Point {
  const { width: W, height: H } = unrotatedSize(page);
  switch (page.rotation) {
    case 90:
      return { x: p.y, y: p.x };
    case 180:
      return { x: W - p.x, y: p.y };
    case 270:
      return { x: H - p.y, y: W - p.x };
    default:
      return { x: p.x, y: H - p.y };
  }
}

/** Rotate a point about a centre by `deg` clockwise, in y-down display space. */
export function rotateAround(p: Point, centre: Point, deg: number): Point {
  if (!deg) return { ...p };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

export interface Placement {
  x: number;
  y: number;
  /** Counter-clockwise degrees, as pdf-lib expects. */
  rotate: number;
}

/**
 * Where to put a display-space rect so pdf-lib draws it in the right place.
 * The returned origin is the rect's bottom-left corner *after* rotation, which
 * is the pivot pdf-lib rotates around.
 */
export function placeRect(
  page: Pick<PageState, 'width' | 'height' | 'rotation'>,
  rect: Rect,
  objectRotation = 0,
): Placement {
  const centre = displayToPdf(page, {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
  const angle = page.rotation - objectRotation;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // width axis and height axis of the drawn box, in PDF space
  const ux = cos * rect.width;
  const uy = sin * rect.width;
  const vx = -sin * rect.height;
  const vy = cos * rect.height;
  return {
    x: centre.x - (ux + vx) / 2,
    y: centre.y - (uy + vy) / 2,
    rotate: angle,
  };
}

/** Where to put a display-space point (e.g. a text baseline start). */
export function placePoint(
  page: Pick<PageState, 'width' | 'height' | 'rotation'>,
  point: Point,
  objectRotation = 0,
  pivot?: Point,
): Placement {
  const rotated = pivot ? rotateAround(point, pivot, objectRotation) : point;
  const p = displayToPdf(page, rotated);
  return { x: p.x, y: p.y, rotate: page.rotation - objectRotation };
}

const rotatePointInPage = (p: Point, w: number, h: number, delta: 90 | 180 | 270): Point => {
  switch (delta) {
    case 90:
      return { x: h - p.y, y: p.x };
    case 180:
      return { x: w - p.x, y: h - p.y };
    default:
      return { x: p.y, y: w - p.x };
  }
};

const rotateRectInPage = (r: Rect, w: number, h: number, delta: 90 | 180 | 270): Rect => {
  switch (delta) {
    case 90:
      return { x: h - (r.y + r.height), y: r.x, width: r.height, height: r.width };
    case 180:
      return { x: w - (r.x + r.width), y: h - (r.y + r.height), width: r.width, height: r.height };
    default:
      return { x: r.y, y: w - (r.x + r.width), width: r.height, height: r.width };
  }
};

/**
 * Rewrite a page's objects so they keep their visual position when the page is
 * rotated by `delta` degrees clockwise. `w`/`h` are the display size *before*
 * the rotation.
 */
export function rotatePageObjects(
  objects: PageObject[],
  w: number,
  h: number,
  delta: 90 | 180 | 270,
): PageObject[] {
  return objects.map((obj) => {
    const base = rotateRectInPage(obj, w, h, delta);
    const rotation = normalizeRotation(obj.rotation + delta);
    switch (obj.kind) {
      case 'ink':
        return {
          ...obj,
          ...base,
          rotation,
          strokes: obj.strokes.map((s) => s.map((p) => rotatePointInPage(p, w, h, delta))),
        };
      case 'markup':
        return {
          ...obj,
          ...base,
          rotation,
          rects: obj.rects.map((r) => rotateRectInPage(r, w, h, delta)),
        };
      case 'shape': {
        const rel = (p?: Point): Point | undefined => {
          if (!p) return undefined;
          switch (delta) {
            case 90:
              return { x: 1 - p.y, y: p.x };
            case 180:
              return { x: 1 - p.x, y: 1 - p.y };
            default:
              return { x: p.y, y: 1 - p.x };
          }
        };
        return { ...obj, ...base, rotation, from: rel(obj.from), to: rel(obj.to) };
      }
      default:
        return { ...obj, ...base, rotation };
    }
  });
}

/** Rotate a page in place (display size swaps for 90/270). */
export function rotatePage(page: PageState, delta: 90 | 180 | 270): PageState {
  const swap = delta !== 180;
  return {
    ...page,
    rotation: normalizeRotation(page.rotation + delta),
    width: swap ? page.height : page.width,
    height: swap ? page.width : page.height,
    crop: page.crop ? rotateRectInPage(page.crop, page.width, page.height, delta) : undefined,
    objects: rotatePageObjects(page.objects, page.width, page.height, delta),
  };
}

export const rectFromPoints = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

export const rectContains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function boundsOfPoints(points: Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rect a page's content is displayed through (crop or full page). */
export const viewRect = (page: PageState): Rect =>
  page.crop ?? { x: 0, y: 0, width: page.width, height: page.height };

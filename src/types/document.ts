/**
 * The editor's document model.
 *
 * A `EditorDocument` is *not* a PDF. It is a description of how to build one:
 * a list of pages that point back at source PDF bytes, plus the objects the user
 * has layered on top of them. Nothing is flattened until export, so every edit
 * stays reversible and the original bytes are never mutated in place.
 *
 * Coordinate system
 * -----------------
 * All object geometry is stored in **display space**: PDF points, origin at the
 * top-left of the page as it is currently displayed, x to the right, y downward.
 * `PageState.width/height` are the page's size in that same space, so they swap
 * when a page is rotated by 90/270. Rotating a page rewrites the coordinates of
 * its objects (see `rotatePageObjects`), which keeps rendering and hit-testing
 * a plain scale-by-zoom with no rotation matrices in the view layer.
 */

export type ObjectId = string;
export type PageId = string;
export type SourceId = string;

/** A PDF the document draws pages from. Bytes are kept as-is for re-export. */
export interface PdfSource {
  id: SourceId;
  name: string;
  bytes: Uint8Array;
  /** Password used to decrypt the source, if it was encrypted. */
  password?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Text alignment inside a text box. */
export type TextAlign = 'left' | 'center' | 'right';

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';

export interface TextStyle {
  size: number;
  color: string;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  lineHeight: number;
}

interface BaseObject extends Rect {
  id: ObjectId;
  /** Clockwise degrees, about the object's centre, in display space. */
  rotation: number;
  locked?: boolean;
  opacity?: number;
}

export interface TextObject extends BaseObject {
  kind: 'text';
  text: string;
  style: TextStyle;
  /** Opaque backdrop, used when covering up text that exists in the source PDF. */
  background?: string;
  /** True when this box was created by editing text that already existed. */
  replacesSourceText?: boolean;
}

export interface ImageObject extends BaseObject {
  kind: 'image';
  /** Key into the document's asset table. */
  assetId: string;
  /** Signatures are images with a different affordance set. */
  isSignature?: boolean;
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'line' | 'arrow';

export interface ShapeObject extends BaseObject {
  kind: 'shape';
  shape: ShapeKind;
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  /** For line/arrow: endpoints relative to the object box (0..1). */
  from?: Point;
  to?: Point;
}

export interface InkObject extends BaseObject {
  kind: 'ink';
  /** Strokes of absolute display-space points. */
  strokes: Point[][];
  stroke: string;
  strokeWidth: number;
}

export type MarkupKind = 'highlight' | 'underline' | 'strikeout';

export interface MarkupObject extends BaseObject {
  kind: 'markup';
  markup: MarkupKind;
  color: string;
  /** Individual line rects, absolute display space. */
  rects: Rect[];
  text?: string;
}

export interface NoteObject extends BaseObject {
  kind: 'note';
  text: string;
  color: string;
  author?: string;
  createdAt: number;
}

/** A region whose underlying content must be destroyed on export. */
export interface RedactObject extends BaseObject {
  kind: 'redact';
  fill: string;
  overlayText?: string;
}

export type FormFieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown';

export interface FormFieldObject extends BaseObject {
  kind: 'field';
  field: FormFieldKind;
  name: string;
  value: string;
  checked?: boolean;
  options?: string[];
  required?: boolean;
  fontSize?: number;
  /** Set when the field already exists in the source PDF; we only fill it. */
  sourceField?: boolean;
}

export type PageObject =
  | TextObject
  | ImageObject
  | ShapeObject
  | InkObject
  | MarkupObject
  | NoteObject
  | RedactObject
  | FormFieldObject;

export type PageObjectKind = PageObject['kind'];

export interface PageState {
  id: PageId;
  /** Null for blank pages inserted by the user. */
  sourceId: SourceId | null;
  /** Zero-based index of the page inside its source PDF. */
  sourceIndex: number;
  /** Absolute display rotation, including the source page's own /Rotate. */
  rotation: Rotation;
  /** Page size in display space, in points. */
  width: number;
  height: number;
  /** Visible region in display space; undefined means the whole page. */
  crop?: Rect;
  objects: PageObject[];
  /** Marks pages whose content must be rasterised on export (redaction). */
  flatten?: boolean;
}

export interface DocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate?: number;
  modificationDate?: number;
}

export interface Bookmark {
  id: string;
  title: string;
  /** Index into `EditorDocument.pages`. */
  pageIndex: number;
  children: Bookmark[];
}

/** Binary blobs (images, signatures) referenced by objects. */
export interface Asset {
  id: string;
  type: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface EditorDocument {
  id: string;
  name: string;
  sources: Record<SourceId, PdfSource>;
  assets: Record<string, Asset>;
  pages: PageState[];
  metadata: DocumentMetadata;
  bookmarks: Bookmark[];
  createdAt: number;
  updatedAt: number;
}

export interface SavedSignature {
  id: string;
  name: string;
  assetId: string;
  createdAt: number;
}

/** Everything the app needs to restore a session after a crash or reload. */
export interface PersistedSession {
  id: string;
  document: EditorDocument;
  savedAt: number;
}

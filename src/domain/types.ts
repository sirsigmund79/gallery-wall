// Domain model (spec §4). All lengths are millimetres (float).

export type Mm = number;
/** Key into the `blobs` table. */
export type BlobRef = string;

export type HangType = 'sawtooth' | 'wire' | 'dring2' | 'custom';

export interface HangSpec {
  type: HangType;
  /** Hook positions relative to the piece's TOP-LEFT corner, in mm. */
  hooks: { dx: Mm; dy: Mm }[];
}

export type PieceStatus = 'idea' | 'owned' | 'planned' | 'hung' | 'storage';
export type Confidence = 'high' | 'check' | 'low';

export interface ArtPiece {
  id: string;
  name: string;
  /** OUTER size including frame. */
  widthMm: Mm;
  heightMm: Mm;
  shape: 'rect' | 'ellipse';
  image?: BlobRef;
  thumb?: BlobRef;
  hang: HangSpec;
  status: PieceStatus;
  tags: string[];
  notes: string;
  measurement: {
    method: 'manual' | 'photo';
    confidence: Confidence;
    spreadPct?: number;
    sourcePhoto?: BlobRef;
  };
  createdAt: number;
  updatedAt: number;
}

export type CalibrationQuality = 'good' | 'check' | 'poor';

export interface CalibrationRecord {
  method: 'measure' | 'measure2axis' | 'rect' | 'marker';
  /** Endpoints in rectified image px. */
  measurements: { p: [number, number]; q: [number, number]; lengthMm: Mm }[];
  pxPerMm: number;
  anisotropy?: { sx: number; sy: number };
  gravity?: { betaDeg: number; gammaDeg: number; f35mm: number; fSource: 'exif' | 'default' };
  /** 3x3 row-major, source px -> rectified px. */
  homography?: number[];
  spreadPct: number;
  quality: CalibrationQuality;
}

export interface ForegroundObject {
  id: string;
  label: string;
  /** 8-bit PNG, same size as rectified wall image, 255 = object. */
  mask: BlobRef;
  visible: boolean;
}

export type ArrangeStyle = 'grid' | 'row' | 'column' | 'salon' | 'centered-on-guide';

export interface Placement {
  pieceId: string;
  /** Top-left in wall coords (mm). */
  x: Mm;
  y: Mm;
  locked?: boolean;
}

export interface Layout {
  id: string;
  name: string;
  placements: Placement[];
  origin?: { style: ArrangeStyle; seed: number };
  createdAt: number;
  updatedAt: number;
}

export interface Wall {
  id: string;
  name: string;
  photo: { original: BlobRef; rectified: BlobRef; widthPx: number; heightPx: number };
  calibration: CalibrationRecord;
  bounds: { left: Mm; top: Mm; right: Mm; bottom: Mm };
  datums: { floorY?: Mm; ceilingY?: Mm };
  foreground: ForegroundObject[];
  layouts: Layout[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredBlob {
  id: BlobRef;
  blob: Blob;
  createdAt: number;
}

export type LengthUnit = 'in' | 'cm' | 'mm';

export interface Settings {
  units: LengthUnit;
  onboardingSeen: boolean;
}

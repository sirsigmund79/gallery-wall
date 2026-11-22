// IndexedDB schema (Dexie) with versioned migrations.
//
// RULES for changing the schema:
//  - Never edit or remove an existing entry in SCHEMA_VERSIONS.
//  - Append a new version with the new `stores` definition and, if existing
//    rows need rewriting, an `upgrade` function.
//  - Add a test in schema.test.ts that opens the previous version, writes
//    old-shaped data, then opens the new version and checks the upgrade.
import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { ArtPiece, Settings, StoredBlob, Wall } from '../domain/types.ts';

export interface SettingsRow extends Settings {
  /** Singleton row key. */
  id: 'app';
}

export interface SchemaVersion {
  version: number;
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => Promise<void>;
}

export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      pieces: 'id, name, updatedAt',
      walls: 'id, name, updatedAt',
      blobs: 'id',
      settings: 'id',
    },
  },
  {
    // v2: index pieces by status and tags (library filters, spec §6.3), and
    // backfill those fields on rows written before they were required.
    version: 2,
    stores: {
      pieces: 'id, name, updatedAt, status, *tags',
    },
    upgrade: async (tx) => {
      await tx
        .table('pieces')
        .toCollection()
        .modify((p: Partial<ArtPiece>) => {
          p.status ??= 'owned';
          p.tags ??= [];
          p.notes ??= '';
          p.shape ??= 'rect';
        });
    },
  },
];

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1]!.version;

export type HangPlanDB = Dexie & {
  pieces: EntityTable<ArtPiece, 'id'>;
  walls: EntityTable<Wall, 'id'>;
  blobs: EntityTable<StoredBlob, 'id'>;
  settings: EntityTable<SettingsRow, 'id'>;
};

/** Open the database with versions up to and including `upTo` (default: all). */
export function createDb(name = 'hangplan', upTo = CURRENT_SCHEMA_VERSION): HangPlanDB {
  const db = new Dexie(name) as HangPlanDB;
  for (const v of SCHEMA_VERSIONS) {
    if (v.version > upTo) break;
    const ver = db.version(v.version).stores(v.stores);
    if (v.upgrade) ver.upgrade(v.upgrade);
  }
  return db;
}

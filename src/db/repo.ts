// Data access. Components go through these functions, not the tables directly.
import type { ArtPiece, BlobRef, Layout, Wall } from '../domain/types.ts';
import { db } from './index.ts';
import { newId } from './ids.ts';

// ── Blobs ──
export async function putBlob(blob: Blob): Promise<BlobRef> {
  const id = newId();
  await db.blobs.put({ id, blob, createdAt: Date.now() });
  return id;
}
export const getBlob = async (id: BlobRef): Promise<Blob | undefined> => (await db.blobs.get(id))?.blob;
export const deleteBlobs = (ids: (BlobRef | undefined)[]) =>
  db.blobs.bulkDelete(ids.filter((x): x is string => !!x));

// ── Pieces ──
export const listPieces = () => db.pieces.orderBy('updatedAt').reverse().toArray();
export const getPiece = (id: string) => db.pieces.get(id);

export async function savePiece(p: ArtPiece): Promise<void> {
  await db.pieces.put({ ...p, updatedAt: Date.now() });
}

/** Walls/layouts that place this piece. */
export async function layoutsUsingPiece(pieceId: string): Promise<{ wall: Wall; layout: Layout }[]> {
  const walls = await db.walls.toArray();
  return walls.flatMap((wall) =>
    wall.layouts.filter((l) => l.placements.some((pl) => pl.pieceId === pieceId)).map((layout) => ({ wall, layout })),
  );
}

export async function deletePiece(id: string): Promise<void> {
  await db.transaction('rw', db.pieces, db.walls, db.blobs, async () => {
    const p = await db.pieces.get(id);
    if (!p) return;
    // Remove from every layout so nothing points at a missing piece.
    const walls = await db.walls.toArray();
    for (const w of walls) {
      let changed = false;
      const layouts = w.layouts.map((l) => {
        const placements = l.placements.filter((pl) => pl.pieceId !== id);
        if (placements.length !== l.placements.length) changed = true;
        return { ...l, placements };
      });
      if (changed) await db.walls.put({ ...w, layouts, updatedAt: Date.now() });
    }
    await deleteBlobs([p.image, p.thumb, p.measurement.sourcePhoto]);
    await db.pieces.delete(id);
  });
}

// ── Walls ──
export const listWalls = () => db.walls.orderBy('updatedAt').reverse().toArray();
export const getWall = (id: string) => db.walls.get(id);

export async function saveWall(w: Wall): Promise<void> {
  await db.walls.put({ ...w, updatedAt: Date.now() });
}

export async function deleteWall(id: string): Promise<void> {
  await db.transaction('rw', db.walls, db.blobs, async () => {
    const w = await db.walls.get(id);
    if (!w) return;
    await deleteBlobs([w.photo.original, w.photo.rectified, w.thumb, ...w.foreground.map((f) => f.mask)]);
    await db.walls.delete(id);
  });
}

export function newLayout(name: string): Layout {
  const now = Date.now();
  return { id: newId(), name, placements: [], createdAt: now, updatedAt: now };
}

// ── Rooms ──
/** Walls of one room in "walk-around" order (the order they were added). */
export const roomOrder = (walls: Wall[]) => [...walls].sort((a, b) => a.createdAt - b.createdAt);

export async function renameRoom(from: string, to: string): Promise<void> {
  await db.walls.where('room').equals(from).modify({ room: to });
}

export async function moveWallToRoom(wallId: string, room: string): Promise<void> {
  await db.walls.update(wallId, { room, updatedAt: Date.now() });
}

export async function renameWall(wallId: string, name: string): Promise<void> {
  await db.walls.update(wallId, { name, updatedAt: Date.now() });
}

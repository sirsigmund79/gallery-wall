import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { CURRENT_SCHEMA_VERSION, SCHEMA_VERSIONS, createDb } from './schema.ts';

let n = 0;
const names: string[] = [];
const freshName = () => {
  const name = `test-${n++}`;
  names.push(name);
  return name;
};
afterEach(async () => {
  await Promise.all(names.splice(0).map((nm) => Dexie.delete(nm)));
});

describe('schema versions', () => {
  it('are strictly increasing integers starting at 1', () => {
    SCHEMA_VERSIONS.forEach((v, i) => expect(v.version).toBe(i + 1));
  });

  it('opens a fresh database at the current version', async () => {
    const db = createDb(freshName());
    await db.open();
    expect(db.verno).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });
});

describe('migration v1 -> v2', () => {
  it('preserves data, backfills status/tags, and enables the new indexes', async () => {
    const name = freshName();

    const v1 = createDb(name, 1);
    await v1.open();
    // Shape of a piece as written by a v1 build (no status/tags/notes/shape).
    await v1.table('pieces').bulkAdd([
      { id: 'a', name: 'Old print', widthMm: 203.2, heightMm: 254, updatedAt: 1 },
      { id: 'b', name: 'Tagged', widthMm: 100, heightMm: 100, status: 'idea', tags: ['blue'], updatedAt: 2 },
    ]);
    await v1.table('settings').put({ id: 'app', units: 'in', onboardingSeen: true });
    v1.close();

    const v2 = createDb(name);
    await v2.open();
    expect(v2.verno).toBe(2);

    const a = await v2.pieces.get('a');
    expect(a).toMatchObject({ name: 'Old print', widthMm: 203.2, status: 'owned', tags: [], notes: '', shape: 'rect' });
    const b = await v2.pieces.get('b');
    expect(b).toMatchObject({ status: 'idea', tags: ['blue'] });

    expect(await v2.pieces.where('status').equals('owned').primaryKeys()).toEqual(['a']);
    expect(await v2.pieces.where('tags').equals('blue').primaryKeys()).toEqual(['b']);
    expect(await v2.settings.get('app')).toMatchObject({ units: 'in', onboardingSeen: true });
    v2.close();
  });
});

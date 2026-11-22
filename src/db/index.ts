import { createDb } from './schema.ts';

/** The app's single database instance. */
export const db = createDb();

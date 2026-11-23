import { create } from 'zustand';
import { saveWall } from '../../db/repo.ts';
import type { Layout, Placement, Wall } from '../../domain/types.ts';
import { commit, initHistory, redo, undo, type History } from './history.ts';

const SAVE_DEBOUNCE_MS = 400;

interface EditorState {
  wall: Wall | null;
  layoutId: string | null;
  history: History<Placement[]>;
  selectedId: string | null;
  snapping: boolean;

  open: (wall: Wall, layoutId?: string) => void;
  close: () => Promise<void>;
  select: (pieceId: string | null) => void;
  setSnapping: (on: boolean) => void;
  /** Record a new placements state (undoable) and autosave. */
  apply: (fn: (ps: Placement[]) => Placement[]) => void;
  undo: () => void;
  redo: () => void;
  switchLayout: (layoutId: string) => void;
  /** Replace the wall's layouts list (create/rename/delete); not undoable. */
  setLayouts: (layouts: Layout[], activeId: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: Wall | null = null;

async function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  const w = pending;
  pending = null;
  if (w) await saveWall(w);
}

function scheduleSave(w: Wall) {
  pending = w;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

if (typeof window !== 'undefined') {
  // Don't lose the last edit when the tab is hidden or closed.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush());
  window.addEventListener('pagehide', () => void flush());
}

/** Write the present placements into the active layout of the wall. */
function withPlacements(wall: Wall, layoutId: string, placements: Placement[]): Wall {
  return {
    ...wall,
    layouts: wall.layouts.map((l) => (l.id === layoutId ? { ...l, placements, updatedAt: Date.now() } : l)),
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  wall: null,
  layoutId: null,
  history: initHistory([]),
  selectedId: null,
  snapping: true,

  open: (wall, layoutId) => {
    const layout = wall.layouts.find((l) => l.id === layoutId) ?? wall.layouts[0]!;
    set({ wall, layoutId: layout.id, history: initHistory(layout.placements), selectedId: null });
  },
  close: async () => {
    await flush();
    set({ wall: null, layoutId: null, history: initHistory([]), selectedId: null });
  },
  select: (selectedId) => set({ selectedId }),
  setSnapping: (snapping) => set({ snapping }),

  apply: (fn) => {
    const { wall, layoutId, history } = get();
    if (!wall || !layoutId) return;
    const next = fn(history.present);
    if (next === history.present) return;
    const w = withPlacements(wall, layoutId, next);
    set({ wall: w, history: commit(history, next) });
    scheduleSave(w);
  },
  undo: () => {
    const { wall, layoutId, history } = get();
    if (!wall || !layoutId) return;
    const h = undo(history);
    const w = withPlacements(wall, layoutId, h.present);
    set({ wall: w, history: h });
    scheduleSave(w);
  },
  redo: () => {
    const { wall, layoutId, history } = get();
    if (!wall || !layoutId) return;
    const h = redo(history);
    const w = withPlacements(wall, layoutId, h.present);
    set({ wall: w, history: h });
    scheduleSave(w);
  },
  switchLayout: (id) => {
    const { wall } = get();
    const layout = wall?.layouts.find((l) => l.id === id);
    if (!wall || !layout) return;
    set({ layoutId: id, history: initHistory(layout.placements), selectedId: null });
  },
  setLayouts: (layouts, activeId) => {
    const { wall, layoutId } = get();
    if (!wall) return;
    const w = { ...wall, layouts };
    const layout = layouts.find((l) => l.id === activeId)!;
    set({
      wall: w,
      layoutId: activeId,
      ...(activeId !== layoutId ? { history: initHistory(layout.placements), selectedId: null } : {}),
    });
    scheduleSave(w);
  },
}));

export { flush as flushEditorSave };

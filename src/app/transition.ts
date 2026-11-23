// "Step into" a wall: zoom the tapped card into the editor with the View
// Transitions API where available. Elsewhere, or with reduced motion, it's an
// ordinary navigation.
import { navigate } from './router.ts';

type VTDocument = Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };

/** Shared element name: set on the tapped card's photo and on the editor canvas. */
export const WALL_VT_NAME = 'wall-photo';

export function stepInto(path: string, from?: HTMLElement | null) {
  const doc = document as VTDocument;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) return navigate(path);
  if (from) from.style.viewTransitionName = WALL_VT_NAME;
  doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        if (from) from.style.viewTransitionName = '';
        navigate(path);
        // Wait for the editor (lazy-loaded) to be on screen, but never long.
        const t0 = performance.now();
        const check = () => (document.querySelector('[data-vt-target]') || performance.now() - t0 > 700 ? resolve() : requestAnimationFrame(check));
        requestAnimationFrame(check);
      }),
  );
}

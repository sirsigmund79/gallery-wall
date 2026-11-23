import { useEffect, useState } from 'react';
import { getBlob } from '../db/repo.ts';

/** Object URL for a stored blob; revoked on change/unmount. */
export function useBlobUrl(ref: string | undefined): string | undefined {
  const [state, setState] = useState<{ ref: string; url: string } | null>(null);
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    let made: string | undefined;
    void getBlob(ref).then((b) => {
      if (!alive || !b) return;
      made = URL.createObjectURL(b);
      setState({ ref, url: made });
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [ref]);
  // Only return a URL that belongs to the current ref.
  return ref && state?.ref === ref ? state.url : undefined;
}

/** Decoded HTMLImageElement for a stored blob (for canvas use). */
export function useBlobImage(ref: string | undefined): HTMLImageElement | undefined {
  const url = useBlobUrl(ref);
  const [state, setState] = useState<{ url: string; img: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setState({ url, img });
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return url && state?.url === url ? state.img : undefined;
}

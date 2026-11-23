import { useBlobUrl } from '../media/useBlobUrl.ts';

interface Props {
  blob?: string;
  alt: string;
  /** Aspect ratio (w/h) for the neutral placeholder. */
  aspect: number;
  label?: string;
}

/** Image thumbnail, or a neutral labelled rectangle at the right aspect. */
export function Thumb({ blob, alt, aspect, label }: Props) {
  const url = useBlobUrl(blob);
  return (
    <div className="thumb">
      {url ? (
        <img src={url} alt={alt} />
      ) : (
        <div
          className="placeholder"
          style={aspect >= 1 ? { width: '88%', aspectRatio: String(aspect) } : { height: '88%', aspectRatio: String(aspect) }}
          aria-label={alt}
          role="img"
        >
          <span>{label ?? ''}</span>
        </div>
      )}
    </div>
  );
}

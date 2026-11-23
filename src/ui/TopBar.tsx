import type { ReactNode } from 'react';

interface Props {
  title: string;
  backHref?: string;
  actions?: ReactNode;
}

export function TopBar({ title, backHref, actions }: Props) {
  return (
    <header className="topbar">
      {backHref && (
        <a className="icon-btn" href={backHref} aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </a>
      )}
      <h1>{title}</h1>
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}

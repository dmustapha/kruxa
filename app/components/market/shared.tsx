// Small building blocks shared by every market panel: source badge, skeletons, honest error and empty states.
import type { ReactNode } from 'react';
import type { Section } from '@/lib/market/hooks';
import type { AsOf, DataSource } from '@/lib/market/types';

/** `source: fixture` is loud on purpose (amber, dashed outline text). `source: chain` is quiet. */
export function SourceBadge({ source, asOf }: { source: DataSource; asOf?: AsOf }) {
  const block = asOf?.block_height ? ` block ${asOf.block_height.toLocaleString('en-US')}` : '';
  return (
    <span className={`mkt-chip mkt-chip-${source}`} title={source === 'fixture' ? 'Offline fixture data. These numbers are not from a NEAR chain.' : `Folded from NEAR chain events${block ? `, as of${block}` : ''}`} data-source={source}>
      <span className="mkt-dot" aria-hidden="true" />
      source: {source}
    </span>
  );
}

export function Skeleton({ lines = 3, height = 16 }: { lines?: number; height?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="mkt-sr">Loading</span>
      <div style={{ display: 'grid', gap: 10 }}>
        {Array.from({ length: lines }, (_, i) => <div key={i} className="mkt-skel" style={{ height, width: i === lines - 1 ? '60%' : '100%' }} />)}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mkt-note" style={{ padding: '12px 0' }}>
      <strong style={{ color: 'var(--fg)', display: 'block', fontSize: 14 }}>{title}</strong>
      {children}
    </div>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mkt-alert" data-tone="bad">
      <strong>Could not load this section</strong>
      {message}
      {onRetry && <div><button type="button" className="mkt-link" onClick={onRetry}>Try again</button></div>}
    </div>
  );
}

/** Renders skeleton, error or the ready body. Keeps every panel's three states identical. */
export function Async<T>({ section, lines, onRetry, children }: { section: Section<T>; lines?: number; onRetry?: () => void; children: (data: T) => ReactNode }) {
  if (section.status === 'loading') return <Skeleton lines={lines} />;
  if (section.status === 'error') return <SectionError message={section.message} onRetry={onRetry} />;
  return <>{children(section.data)}</>;
}

export function Panel({ title, id, right, children, className = '' }: { title: string; id: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mkt-panel ${className}`} aria-labelledby={id}>
      <header><h2 id={id}>{title}</h2>{right}</header>
      {children}
    </section>
  );
}

import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api/client';

export function LoadingBlock({ label = 'Loading', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="card">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skel" style={{ width: `${90 - i * 18}%`, margin: '10px 0' }} />)}
    </div>
  );
}

export function SkeletonCards({ n = 6 }: { n?: number }) {
  return (
    <div role="status" aria-busy="true" className="grid grid-cards">
      <span className="sr-only">Loading launches</span>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="lcard" aria-hidden="true"><div className="skel" style={{ width: '40%', height: 24 }} /><div className="skel" style={{ width: '70%' }} /><div className="skel" style={{ height: 10 }} /><div className="skel" style={{ width: '55%' }} /></div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="state"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

const HINT: Record<string, string> = {
  unreachable: 'The indexer is not reachable from this browser. Pages that can read the chain directly still work; the rest wait for the indexer.',
  timeout: 'The indexer is slow to answer. Try again in a moment.',
  not_found: 'The indexer has no record of this.',
};

export function ErrorState({ error, onRetry, what = 'this data' }: { error: ApiError; onRetry?: () => void; what?: string }) {
  return (
    <div role="alert" className="state state-error">
      <h3>Could not load {what}</h3>
      <p>{error.message} {HINT[error.code] ?? ''}</p>
      <p className="mono">error code: {error.code}</p>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

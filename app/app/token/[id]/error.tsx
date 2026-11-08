'use client';
import '@/components/market/market.css';

export default function TokenError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mkt-root">
      <section className="mkt-panel" role="alert">
        <h2>Something broke on this page</h2>
        <p>{error.message || 'Unexpected error.'}</p>
        <button type="button" className="mkt-link" onClick={reset}>Try again</button>
      </section>
    </div>
  );
}

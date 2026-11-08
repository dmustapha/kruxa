import '@/components/market/market.css';

export default function TokenNotFound() {
  return (
    <div className="mkt-root">
      <section className="mkt-panel">
        <h1 style={{ fontSize: '1.25rem' }}>No such token</h1>
        <p>A launch id is a whole number, for example /token/1. <a href="/launches">Browse launches</a>.</p>
      </section>
    </div>
  );
}

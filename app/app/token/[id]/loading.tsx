import '@/components/market/market.css';

export default function Loading() {
  return (
    <div className="mkt-root" role="status" aria-busy="true">
      <span className="mkt-sr">Loading token page</span>
      <div className="mkt-skel" style={{ height: 36, width: '40%' }} />
      <div className="mkt-skel" style={{ height: 48, width: '60%', marginTop: 12 }} />
      <div className="mkt-skel" style={{ height: 360, marginTop: 16 }} />
    </div>
  );
}

import { loadThesis } from '@/lib/thesis';
import { ProofBadge } from '@/components/ui/Badges';

/** Section B: the committed NEAR thesis pack, shown as RECORDED data with its own verdict. Server component: reads copies under public/thesis. */
export function ThesisSection() {
  const t = loadThesis();
  if (!t) return null;
  const h = t.headline;
  return (
    <section aria-labelledby="ins-b-h">
      <h2 id="ins-b-h">NEAR network thesis <ProofBadge status="RECORDED" /></h2>
      <div className="callout info">
        <p><b>Intents activity is growing, but it does not lead the rest of NEAR&apos;s usage.</b> The pack tested whether week-on-week growth in settlement transactions at intents.near leads growth in daily active accounts by 1 to 28 days. Over {h.n} days the best lead is r = {h.bestR.toFixed(3)} at {h.bestLag} days, with a permutation p of {h.p.toFixed(3)} (a chance level of r = {h.null95.toFixed(3)} is the 95th percentile). That is not distinguishable from chance. The incremental test adds {h.deltaR2.toFixed(4)} to R-squared (p = {h.incrementalP.toFixed(3)}).</p>
        <p>Correlation is not causation, and the data is a recorded pull from a public BigQuery dataset, not live. Kruxa&apos;s own activity is never used as evidence.</p>
      </div>
      <p><a href="/thesis/index.html" target="_blank" rel="noreferrer noopener">Open the full recorded dashboard<span className="sr-only"> (new tab)</span></a> · <a href="/thesis/THESIS.md" target="_blank" rel="noreferrer noopener">Read THESIS.md, including the evidence against and what would change the verdict<span className="sr-only"> (new tab)</span></a></p>
      <div className="grid grid-2">
        {t.charts.map((c) => (
          <figure key={c.id} className="card" style={{ margin: 0 }} aria-labelledby={`th-${c.id}`}>
            <figcaption id={`th-${c.id}`} style={{ fontWeight: 600, color: 'var(--fg)' }}>{c.title}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/thesis/charts/${c.id}.svg`} alt={`${c.title}. ${c.desc}.`} loading="lazy" style={{ width: '100%', height: 'auto', marginTop: 8 }} />
            <p>{c.reading}</p>
            <details>
              <summary>Data, query and checksum</summary>
              <p className="mono">{c.meta}</p>
              <p className="mono">Query file: queries/{c.query}</p>
              <p className="hint">The numbers behind the chart are in the committed snapshot named above (thesis/snapshots in the repository). Every figure on this page is written by the build script from those files.</p>
            </details>
          </figure>
        ))}
      </div>
    </section>
  );
}

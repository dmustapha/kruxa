import { SourceBadge } from '@/components/ui/Badges';
import { fmtDate, titleCase } from '@/lib/format';
import type { EventRef } from '@/lib/api/types';

export function EventLog({ events, bookHash }: { events: EventRef[] | undefined; bookHash: string }) {
  return (
    <section className="card" aria-labelledby="log-h">
      <h2 id="log-h">Event log</h2>
      <p className="hint">Folded from the contract&apos;s own logs. The latest <code>book_hash</code> the contract logged is <code title={bookHash}>{bookHash.slice(0, 16)}</code>.</p>
      {!events || events.length === 0 ? <p>No events indexed for this launch.</p> : (
        <ol className="tl">
          {events.map((e, i) => (
            <li key={`${e.receipt_id}-${i}`}>
              <b>{titleCase(e.event)}</b> <SourceBadge source={e.source} />
              <span className="when">{e.time ? fmtDate(e.time) : 'time n/a'} · block {e.block_height} · receipt {e.receipt_id}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

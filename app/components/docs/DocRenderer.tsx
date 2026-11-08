import type { Block } from '@/content/types';
import { Inline } from './Inline';

const NOTE_LABEL: Record<string, string> = { info: 'Note', warn: 'Read this', unproven: 'Unproven path', draft: 'Draft' };

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="kx-table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}><Inline text={h} /></th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case 'h2': return <h2 id={b.id}><a className="kx-anchor" href={`#${b.id}`}>{b.text}</a></h2>;
    case 'h3': return <h3>{b.text}</h3>;
    case 'p': return <p><Inline text={b.text} /></p>;
    case 'ul': return <ul>{b.items.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>;
    case 'ol': return <ol>{b.items.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ol>;
    case 'table': return <Table head={b.head} rows={b.rows} />;
    case 'code': return <pre><code>{b.text}</code></pre>;
    case 'note':
      return (
        <aside className={`kx-note kx-note-${b.kind}`} role="note">
          <strong>{b.title ?? NOTE_LABEL[b.kind]}</strong>
          <p><Inline text={b.text} /></p>
        </aside>
      );
  }
}

export function DocRenderer({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b, i) => <BlockView key={i} b={b} />)}</>;
}

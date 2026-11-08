'use client';
import { useState } from 'react';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-quiet" style={{ minHeight: 36, padding: '4px 10px', fontSize: '0.8125rem' }}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => undefined); }}>
      {done ? 'Copied' : label}
    </button>
  );
}

export function CommandBlock({ command, label = 'Command' }: { command: string; label?: string }) {
  return (
    <div>
      <div className="row between"><span className="eyebrow" style={{ margin: 0 }}>{label}</span><CopyButton text={command} /></div>
      <pre aria-label={label}><code>{command}</code></pre>
    </div>
  );
}

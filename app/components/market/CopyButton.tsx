'use client';
import { useState } from 'react';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { setDone(false); }
  }
  return (
    <button type="button" className="mkt-copy" onClick={() => void copy()} aria-label={`Copy ${label}`}>
      <span aria-hidden="true">{done ? 'Copied' : 'Copy'}</span><span className="mkt-sr" role="status">{done ? `${label} copied` : ''}</span>
    </button>
  );
}

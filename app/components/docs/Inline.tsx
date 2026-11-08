import Link from 'next/link';
import { parseInline } from './markup';

export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((t, i) => {
        if (t.k === 'code') return <code key={i}>{t.v}</code>;
        if (t.k === 'bold') return <strong key={i}>{t.v}</strong>;
        if (t.k === 'link') {
          const external = /^https?:/.test(t.href);
          return external ? (
            <a key={i} href={t.href} rel="noreferrer noopener">{t.v}</a>
          ) : (
            <Link key={i} href={t.href}>{t.v}</Link>
          );
        }
        return <span key={i}>{t.v}</span>;
      })}
    </>
  );
}

'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { PageGroup } from '@/content/types';

export interface NavItem { href: string; title: string; group: PageGroup }

const ORDER: PageGroup[] = ['Start', 'Use', 'Trust', 'Reference'];

export function DocsNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <>
      <label className="kx-docs-select" htmlFor="kx-docs-select">
        {label}
        <select id="kx-docs-select" value={path} onChange={(e) => router.push(e.target.value)}>
          {items.map((i) => <option key={i.href} value={i.href}>{i.title}</option>)}
        </select>
      </label>
      <nav className="kx-docs-side" aria-label={label}>
        {ORDER.map((g) => {
          const inGroup = items.filter((i) => i.group === g);
          if (!inGroup.length) return null;
          return (
            <div key={g}>
              <p className="kx-docs-group">{g}</p>
              <ul>
                {inGroup.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={path === i.href ? 'page' : undefined}>{i.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );
}

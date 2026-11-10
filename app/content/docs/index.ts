import type { Page } from '../types';
import { howItWorks } from './pages/how-it-works';
import { creators } from './pages/creators';
import { buyers } from './pages/buyers';
import { fees } from './pages/fees';
import { verify } from './pages/verify';
import { security } from './pages/security';
import { charter } from './pages/charter';
import { faq } from './pages/faq';
import { glossary } from './pages/glossary';
import { api } from './pages/api';

export const DOC_PAGES: Page[] = [howItWorks, creators, buyers, fees, verify, security, charter, faq, glossary, api];

export const docBySlug = (slug: string): Page | undefined => DOC_PAGES.find((p) => p.slug === slug);

export const docNav = () => DOC_PAGES.map((p) => ({ href: `/docs/${p.slug}`, title: p.title, group: p.group }));

export function neighbours(slug: string): { prev?: Page; next?: Page } {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  return { prev: i > 0 ? DOC_PAGES[i - 1] : undefined, next: i >= 0 ? DOC_PAGES[i + 1] : undefined };
}

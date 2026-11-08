import type { Page } from '../types';
import { terms } from './terms';
import { privacy } from './privacy';
import { risk } from './risk';

export const LEGAL_PAGES: Page[] = [terms, privacy, risk];

export const legalBySlug = (slug: string): Page | undefined => LEGAL_PAGES.find((p) => p.slug === slug);

export const legalNav = () => LEGAL_PAGES.map((p) => ({ href: `/legal/${p.slug}`, title: p.title, group: p.group }));

import { slugify } from '@/components/docs/markup';
import type { Block, NoteKind } from './types';

export const h2 = (text: string): Block => ({ t: 'h2', id: slugify(text), text });
export const h3 = (text: string): Block => ({ t: 'h3', text });
export const p = (text: string): Block => ({ t: 'p', text });
export const ul = (...items: string[]): Block => ({ t: 'ul', items });
export const ol = (...items: string[]): Block => ({ t: 'ol', items });
export const table = (head: string[], ...rows: string[][]): Block => ({ t: 'table', head, rows });
export const code = (text: string, lang = 'bash'): Block => ({ t: 'code', lang, text });
export const note = (kind: NoteKind, text: string, title?: string): Block => ({ t: 'note', kind, text, title });

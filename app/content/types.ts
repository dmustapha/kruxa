// Shared shape for docs and legal content. Content is data so it can be linted and tested.
export type NoteKind = 'info' | 'warn' | 'unproven' | 'draft';

export type Block =
  | { t: 'h2'; id: string; text: string }
  | { t: 'h3'; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'code'; lang?: string; text: string }
  | { t: 'note'; kind: NoteKind; title?: string; text: string };

export type PageGroup = 'Start' | 'Use' | 'Trust' | 'Reference';

export interface Page {
  slug: string;
  title: string;
  summary: string;
  group: PageGroup;
  blocks: Block[];
}

// Asks the core contract what it thinks of a Charter. Tries the `preview_charter` view (interface request IR-1, not in the
// deployed ABI yet), falls back to `required_deposit` (exists today; it panics with the first rule code), and reports
// "unreachable" honestly when neither answers. The Studio shows this beside the local mirror and prints any disagreement.
import { view as nearView } from '../near';
import { toContractJson, type TrialParams, type Violation } from './rules';

export type ContractAnswer =
  | { kind: 'ok'; via: 'preview_charter' | 'required_deposit'; deposit: string | null }
  | { kind: 'refused'; via: 'preview_charter' | 'required_deposit'; codes: string[]; message: string }
  | { kind: 'unreachable'; message: string };

type View = (method: string, args?: Record<string, unknown>) => Promise<unknown>;

export const extractCodes = (text: string): string[] => [...new Set(text.match(/\bR_[A-Z0-9_]+\b/g) ?? [])];
const methodMissing = (text: string): boolean => /MethodNotFound|method .* not found|no such method|MethodResolveError|CodeDoesNotExist/i.test(text);
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'unknown error';

function fromPreview(out: unknown): ContractAnswer | null {
  if (typeof out !== 'object' || out === null) return null;
  const o = out as { ok?: boolean; codes?: Array<string | { code: string }>; deposit?: string | null };
  if (typeof o.ok !== 'boolean') return null;
  if (o.ok) return { kind: 'ok', via: 'preview_charter', deposit: o.deposit ?? null };
  const codes = (o.codes ?? []).map((c) => (typeof c === 'string' ? c : c.code));
  return { kind: 'refused', via: 'preview_charter', codes, message: `preview_charter refused with ${codes.join(', ') || 'no code'}` };
}

export async function askContract(params: TrialParams, view: View = nearView as View): Promise<ContractAnswer> {
  const json = toContractJson(params);
  try {
    const parsed = fromPreview(await view('preview_charter', { params: json }));
    if (parsed) return parsed;
  } catch (e) {
    const text = msg(e);
    if (!methodMissing(text)) {
      const codes = extractCodes(text);
      if (codes.length) return { kind: 'refused', via: 'preview_charter', codes, message: text };
      return { kind: 'unreachable', message: text };
    }
  }
  try {
    const deposit = await view('required_deposit', { params: json });
    return { kind: 'ok', via: 'required_deposit', deposit: String(deposit) };
  } catch (e) {
    const text = msg(e);
    const codes = extractCodes(text);
    return codes.length ? { kind: 'refused', via: 'required_deposit', codes, message: text } : { kind: 'unreachable', message: text };
  }
}

/** Compares the local mirror's FIRST code with the contract's first code (required_deposit stops at the first violation). */
export function agreement(local: Violation[], answer: ContractAnswer): 'agree' | 'disagree' | 'n/a' {
  if (answer.kind === 'unreachable') return 'n/a';
  if (answer.kind === 'ok') return local.length === 0 ? 'agree' : 'disagree';
  const first = local[0]?.code;
  return first !== undefined && answer.codes[0] === first ? 'agree' : answer.codes.every((c) => local.some((l) => l.code === c)) && local.length > 0 ? 'agree' : 'disagree';
}

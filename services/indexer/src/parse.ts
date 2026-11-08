import { EVENT_STANDARD, EVENT_VERSION } from "./types.ts";
import type { ContractSet, NearBlock, ParsedEvent } from "./types.ts";

const PREFIX = "EVENT_JSON:";

/** Event names each contract kind may emit. Anything else from that contract is ignored. */
export const CORE_EVENTS = new Set([
  "charter_created", "trial_opened", "contributed", "walked", "verdict", "pass_allocated", "payout_resolved",
  "tokens_claimed", "residue_swept", "dissolved", "bond_reclaimed", "token_creation_failed",
  "contribution_submitted", "contribution_failed", "deposit_rejected", "deposit_rejected_refundable",
  "paused", "frozen", "unpaused",
]);
export const MARKET_EVENTS = new Set(["pool_opened", "swap", "creator_claimed", "platform_withdrawn", "market_paused"]);

/** Parse one log line. Returns the data objects of a valid `kruxa` 1.0.0 event, or [] for anything else. */
export function parseLogLine(line: string): Array<{ event: string; data: Record<string, unknown> }> {
  if (!line.startsWith(PREFIX)) return [];
  let body: unknown;
  try {
    body = JSON.parse(line.slice(PREFIX.length));
  } catch {
    return [];
  }
  if (!isRecord(body) || body.standard !== EVENT_STANDARD || body.version !== EVENT_VERSION) return [];
  if (typeof body.event !== "string" || !Array.isArray(body.data)) return [];
  const event = body.event;
  return body.data.filter(isRecord).map((data) => ({ event, data }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A receipt whose outcome failed has its state reverted, so its logs must not move the read model. */
function succeeded(status: unknown): boolean {
  return !(isRecord(status) && "Failure" in status);
}

/**
 * Extract kruxa events from a block. Only logs emitted by the configured contracts count
 * (anyone can print `EVENT_JSON` from their own contract), and only from successful receipts.
 */
export function extractEvents(block: NearBlock, contracts: ContractSet): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  let ord = 0;
  for (const shard of block.shards) {
    for (const r of shard.receipt_execution_outcomes ?? []) {
      const o = r.execution_outcome;
      const kind = contracts.core.includes(o.outcome.executor_id) ? "core" : contracts.market.includes(o.outcome.executor_id) ? "market" : null;
      const thisOrd = ord++;
      if (!kind || !succeeded(o.outcome.status)) continue;
      const allowed = kind === "core" ? CORE_EVENTS : MARKET_EVENTS;
      o.outcome.logs.forEach((line, logIndex) => {
        for (const e of parseLogLine(line)) {
          if (allowed.has(e.event)) out.push({ receiptId: o.id, logIndex, ord: thisOrd, contract: o.outcome.executor_id, kind, event: e.event, data: e.data });
        }
      });
    }
  }
  return out;
}

import { EVENT_STANDARD, EVENT_VERSION } from "./types.ts";
import type { ContractKind, ContractSet, NearBlock, ParsedEvent } from "./types.ts";

const PREFIX = "EVENT_JSON:";

/** Event names each contract kind may emit. Anything else from that contract is ignored. */
export const CORE_EVENTS = new Set([
  "charter_created", "trial_opened", "contributed", "walked", "verdict", "pass_allocated", "payout_resolved",
  "tokens_claimed", "residue_swept", "dissolved", "bond_reclaimed", "token_creation_failed",
  "contribution_submitted", "contribution_failed", "deposit_rejected", "deposit_rejected_refundable",
  "paused", "frozen", "unpaused", "global_cap_lowered", "global_cap_queued", "global_cap_applied", "launch_cap_queued", "launch_cap_applied",
  "beta_opened", "market_set", "market_handoff", "market_leg_resolved", "market_opened", "genesis_relayer_set", "genesis_paused", "genesis_resumed",
  "genesis_committed", "genesis_confirmed", "genesis_aborted", "attest_log", "external_pool",
  "genesis_reopened", "f0_message_registered", "f0_sign_requested", "halted", "resumed", "upgrade_queued", "upgrade_cancelled", "upgraded",
  "force_resolve_queued", "op_force_resolved", "solvency_report", "owed_near_credited", "owed_near_withdrawn", "refund_batch", "refund_route_set",
  "orphan_credit_refused", "token_delivery_refused", "creator_alloc_claimed", "tokens_swept", "stream_lengthened",
]);

/** Events the instant launcher emits (INSTANT-ABI section 9). `paused`, `frozen`, `unpaused` and `platform_withdrawn` share names with core and market; the contract kind tells them apart. */
export const LAUNCHER_EVENTS = new Set([
  "instant_created", "instant_token_ready", "instant_creation_failed", "instant_seeded", "instant_handoff", "instant_leg_resolved", "instant_opened",
  "instant_abandoned", "instant_aborted", "alloc_claimed", "fee_credited", "platform_withdrawn", "deposit_reclaimed", "owed_credited", "owed_claimed",
  "paused", "frozen", "unpaused", "beta_opened", "market_set", "symbol_reserved", "cap_lowered", "cap_queued", "cap_applied",
]);
export const MARKET_EVENTS = new Set(["pool_opened", "swap", "creator_claimed", "platform_withdrawn", "market_paused", "owed_credited", "owed_claimed"]);

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

function kindOf(c: ContractSet, account: string): ContractKind | null {
  if (c.core.includes(account)) return "core";
  if (c.market.includes(account)) return "market";
  if (c.launcher?.includes(account)) return "launcher";
  return null;
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
      const kind = kindOf(contracts, o.outcome.executor_id);
      const thisOrd = ord++;
      if (!kind || !succeeded(o.outcome.status)) continue;
      const allowed = kind === "core" ? CORE_EVENTS : kind === "market" ? MARKET_EVENTS : LAUNCHER_EVENTS;
      o.outcome.logs.forEach((line, logIndex) => {
        for (const e of parseLogLine(line)) {
          if (allowed.has(e.event)) out.push({ receiptId: o.id, logIndex, ord: thisOrd, contract: o.outcome.executor_id, kind, event: e.event, data: e.data });
        }
      });
    }
  }
  return out;
}

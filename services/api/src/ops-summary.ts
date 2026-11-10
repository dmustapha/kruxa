/** Events shown in the public ops log, their category, and the one-line English summary. Only events the contracts really emit (EVENTS.md). */
export type OpsCategory = "pause" | "caps" | "config" | "halt" | "upgrade" | "force_resolve" | "solvency" | "owed" | "custody" | "refunds" | "genesis" | "treasury";

export const OPS_CATEGORY: Record<string, OpsCategory> = {
  paused: "pause", frozen: "pause", unpaused: "pause", market_paused: "pause", genesis_paused: "pause", genesis_resumed: "pause",
  global_cap_lowered: "caps", global_cap_queued: "caps", global_cap_applied: "caps", launch_cap_queued: "caps", launch_cap_applied: "caps",
  cap_lowered: "caps", cap_queued: "caps", cap_applied: "caps",
  beta_opened: "config", market_set: "config", genesis_relayer_set: "config", symbol_reserved: "config",
  halted: "halt", resumed: "halt",
  upgrade_queued: "upgrade", upgrade_cancelled: "upgrade", upgraded: "upgrade",
  force_resolve_queued: "force_resolve", op_force_resolved: "force_resolve",
  solvency_report: "solvency",
  owed_near_credited: "owed", owed_near_withdrawn: "owed", owed_credited: "owed", owed_claimed: "owed",
  creator_alloc_claimed: "custody", tokens_swept: "custody", token_delivery_refused: "custody", stream_lengthened: "custody",
  refund_batch: "refunds", refund_route_set: "refunds", orphan_credit_refused: "refunds", deposit_rejected_refundable: "refunds",
  genesis_reopened: "genesis", f0_message_registered: "genesis", f0_sign_requested: "genesis", genesis_aborted: "genesis", attest_log: "genesis",
  platform_withdrawn: "treasury",
};

export const OPS_EVENT_NAMES = Object.keys(OPS_CATEGORY);

type D = Record<string, unknown>;

function when(v: unknown): string {
  return typeof v === "string" && /^[0-9]+$/.test(v) ? new Date(Number(BigInt(v) / 1_000_000n)).toISOString() : "unknown time";
}

const s = (v: unknown): string => String(v);

const SUMMARIES: Record<string, (d: D, by: string, who: string) => string> = {
  paused: (_d, by, who) => `${who} paused${by}`,
  frozen: (d, by, who) => `${who} frozen${by} until ${when(d.until)}`,
  unpaused: (_d, _by, who) => `${who} unpaused`,
  beta_opened: (_d, by, who) => `${who} creator gate opened${by}`,
  market_set: (d, _by, who) => `${who} market set to ${s(d.market)}`,
  genesis_relayer_set: (d) => `genesis relayer set to ${s(d.account)}`,
  genesis_paused: (_d, by) => `genesis paused${by}`,
  genesis_resumed: () => "genesis resumed",
  cap_lowered: (d) => `instant ${s(d.kind)} seed cap lowered to ${s(d.value)}`,
  cap_queued: (d) => `instant ${s(d.kind)} seed cap raise to ${s(d.value)} queued, effective ${when(d.effective_at)}`,
  cap_applied: (d) => `instant ${s(d.kind)} seed cap set to ${s(d.value)}`,
  symbol_reserved: (d) => `symbol ${s(d.symbol)} reserved`,
  global_cap_lowered: (d) => `global cap lowered to ${s(d.value)}`,
  global_cap_queued: (d) => `global cap raise to ${s(d.value)} queued, effective ${when(d.effective_at)}`,
  global_cap_applied: (d) => `global cap set to ${s(d.value)}`,
  launch_cap_queued: (d) => `per-launch cap raise to ${s(d.value)} queued, effective ${when(d.effective_at)}`,
  launch_cap_applied: (d) => `per-launch cap set to ${s(d.value)}`,
  market_paused: (d, by) => `market ${d.paused === false ? "unpaused" : "paused"}${by}`,
  halted: (d, by) => `launch ${s(d.launch_id)} halted${by}: ${s(d.reason)}`,
  resumed: (d) => `launch ${s(d.launch_id)} resumed`,
  upgrade_queued: (d) => `core upgrade ${s(d.code_hash).slice(0, 12)} queued, deployable from ${when(d.effective_at)}`,
  upgrade_cancelled: (d, by) => `core upgrade ${s(d.code_hash).slice(0, 12)} cancelled${by}`,
  upgraded: (d) => `core upgraded to code ${s(d.code_hash).slice(0, 12)}`,
  force_resolve_queued: (d) => `force-resolve of a stuck ${s(d.amount)} leg on launch ${s(d.launch_id)} queued (ok=${s(d.ok)}), effective ${when(d.effective_at)}`,
  op_force_resolved: (d) => `stuck ${s(d.amount)} leg on launch ${s(d.launch_id)} force-resolved (ok=${s(d.ok)})`,
  solvency_report: (d) => `solvency check ${d.ok === true ? "passed" : "FAILED"}${d.intents_alert === true ? ", intents alert" : ""}`,
  owed_near_credited: (d) => `${s(d.amount)} yoctoNEAR owed to ${s(d.account)} after a failed push`,
  owed_near_withdrawn: (d) => `${s(d.account)} withdrew ${s(d.amount)} yoctoNEAR owed`,
  owed_credited: (d) => `${s(d.amount)} of ${s(d.token)} owed to ${s(d.account)} (${s(d.reason)})`,
  owed_claimed: (d) => `${s(d.account)} claimed ${s(d.amount)} of ${s(d.token)} owed`,
  creator_alloc_claimed: (d) => `creator allocation claim of ${s(d.amount)} on launch ${s(d.launch_id)} by ${s(d.recipient)}`,
  tokens_swept: (d) => `${s(d.amount)} unclaimed tokens swept on launch ${s(d.launch_id)} (burn mode ${s(d.mode)})`,
  token_delivery_refused: (d) => `token delivery refused on launch ${s(d.launch_id)} (${s(d.kind)} to ${s(d.receiver)}): ${s(d.reason)}`,
  stream_lengthened: (d) => `stream of launch ${s(d.launch_id)} lengthened to end ${when(d.end_ns)}`,
  refund_batch: (d) => `refund batch on launch ${s(d.launch_id)}: ${s(d.handled)} handled, ${s(d.paid)} paid`,
  refund_route_set: (d) => `refund of ${s(d.holder)} on launch ${s(d.launch_id)} routed to ${s(d.intents_account)}`,
  orphan_credit_refused: (d) => `orphan Intents credit refused on launch ${s(d.launch_id)} for ${s(d.holder)}`,
  deposit_rejected_refundable: (d) => `deposit refused on launch ${s(d.launch_id)} for ${s(d.holder)} (${s(d.code)}), refundable`,
  genesis_reopened: (d, by) => `genesis of launch ${s(d.launch_id)} reopened${by}`,
  genesis_aborted: (d, by) => `genesis of launch ${s(d.launch_id)} aborted${by}: ${s(d.reason)}`,
  f0_message_registered: (d) => `F0 message ${s(d.tx_index)} registered for launch ${s(d.launch_id)}`,
  f0_sign_requested: (d) => `F0 signature ${s(d.tx_index)} requested for launch ${s(d.launch_id)}`,
  attest_log: (d) => `attestation hash logged for launch ${s(d.launch_id)}`,
  platform_withdrawn: (d) => `platform withdrew ${s(d.amount)} to ${s(d.to)}`,
};

export function opsSummary(event: string, d: D, kind: string): string {
  const by = typeof d.by === "string" ? ` by ${d.by}` : "";
  const who = kind === "launcher" ? "instant launcher" : "core";
  return (SUMMARIES[event] ?? ((e: D) => `${event} ${JSON.stringify(e)}`))(d, by, who);
}

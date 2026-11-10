/**
 * Fixture events for the operations, custody and governance events the core gained after the first indexer (EVENTS.md "Operations and custody").
 * Layered on top of the base fixture by `generateFullFixtureBlocks`: base launches 1 (ALPHA, passed, trading), 2 (BRAVO, dissolved), 3 (CHARLIE, open)
 * and 4 (DELTA, passed). Field names and shapes are copied from the emit sites in contracts/core/src; nothing here is invented.
 */
export interface OpsLog {
  contract: string;
  event: string;
  data: Record<string, unknown>;
}

export interface OpsTarget {
  push(timeSec: number, logs: OpsLog[]): void;
}

/** Testnet timelock profile: the contract scales its delays by config (`delay_ns`), so the fixture uses minutes, like the instant demo profile. */
const UPGRADE_DELAY = 600;
const FORCE_DELAY = 300;
const CAP_DELAY = 900;
const ns = (sec: number): string => (BigInt(sec) * 1_000_000_000n).toString();
const hex = (c: string): string => c.repeat(64);

export const OPS_HASHES = { upgradeCancelled: hex("a"), upgradeApplied: hex("b"), upgradePending: hex("c") } as const;

export function opsScenario(b: OpsTarget, core: string, start: number): void {
  const at = (n: number): number => start + n * 60;
  const c = (event: string, data: Record<string, unknown>): OpsLog => ({ contract: core, event, data });
  adminEvents(b, c, at);
  governanceEvents(b, c, at);
  solvencyEvents(b, c, at);
  custodyEvents(b, c, at);
  genesisEvents(b, c, at);
}

type Mk = (event: string, data: Record<string, unknown>) => OpsLog;
type At = (n: number) => number;

function adminEvents(b: OpsTarget, c: Mk, at: At): void {
  b.push(at(0), [c("beta_opened", { by: "owner.testnet" })]);
  b.push(at(1), [c("market_set", { market: "market.fixture.testnet" })]);
  b.push(at(2), [c("genesis_relayer_set", { account: "relayer.fixture.testnet" })]);
  b.push(at(3), [c("frozen", { by: "guardian.testnet", until: ns(at(3) + UPGRADE_DELAY) })]);
  b.push(at(4), [c("unpaused", {})]);
  b.push(at(5), [c("launch_cap_queued", { value: "2000000000", effective_at: ns(at(5) + CAP_DELAY) })]);
  b.push(at(6), [c("global_cap_lowered", { value: "1000000000" })]);
  b.push(at(7), [c("genesis_paused", { by: "guardian.testnet" })]);
  b.push(at(8), [c("genesis_resumed", {})]);
}

function governanceEvents(b: OpsTarget, c: Mk, at: At): void {
  b.push(at(10), [c("upgrade_queued", { code_hash: OPS_HASHES.upgradeCancelled, effective_at: ns(at(10) + UPGRADE_DELAY) })]);
  b.push(at(11), [c("upgrade_cancelled", { code_hash: OPS_HASHES.upgradeCancelled, by: "guardian.testnet" })]);
  b.push(at(12), [c("upgrade_queued", { code_hash: OPS_HASHES.upgradeApplied, effective_at: ns(at(12) + UPGRADE_DELAY) })]);
  b.push(at(13) + UPGRADE_DELAY, [c("upgraded", { code_hash: OPS_HASHES.upgradeApplied })]);
  b.push(at(14) + UPGRADE_DELAY, [c("upgrade_queued", { code_hash: OPS_HASHES.upgradePending, effective_at: ns(at(14) + 2 * UPGRADE_DELAY) })]);
  b.push(at(15), [c("halted", { launch_id: "3", by: "guardian.testnet", reason: "metadata dispute, trial paused for review" })]);
  b.push(at(16), [c("resumed", { launch_id: "3" })]);
  b.push(at(17), [c("halted", { launch_id: "4", by: "owner.testnet", reason: "genesis rehearsal in progress" })]);
  b.push(at(18), [c("force_resolve_queued", { launch_id: "2", amount: "5000000", ok: true, effective_at: ns(at(18) + FORCE_DELAY) })]);
  b.push(at(19) + FORCE_DELAY, [c("op_force_resolved", { launch_id: "2", amount: "5000000", ok: true, evidence: "receipt 4kYb...fixture shows ft_transfer succeeded" })]);
  b.push(at(20), [c("force_resolve_queued", { launch_id: "1", amount: "250000", ok: false, effective_at: ns(at(20) + FORCE_DELAY) })]);
}

function solvencyEvents(b: OpsTarget, c: Mk, at: At): void {
  const leg = (balance: string, liability: string): Record<string, unknown> => ({ balance, liability, ok: BigInt(balance) >= BigInt(liability) });
  const report = (t: number, native: Record<string, unknown>, intents: Record<string, unknown> | null, alert: boolean): OpsLog =>
    c("solvency_report", { at: ns(t), native, intents, ok: native.ok === true && (intents === null || intents.ok === true), intents_alert: alert });
  b.push(at(30), [report(at(30), leg("90000000", "60000000"), leg("12000000", "9000000"), false)]);
  b.push(at(31), [report(at(31), leg("50000000", "60000000"), leg("12000000", "9000000"), false)]);
  b.push(at(32), [report(at(32), leg("90000000", "60000000"), null, true)]);
}

function custodyEvents(b: OpsTarget, c: Mk, at: At): void {
  b.push(at(40), [c("creator_alloc_claimed", { launch_id: "1", recipient: "alice.testnet", amount: "40000000000" })]);
  b.push(at(41), [c("payout_resolved", { launch_id: "1", kind: "AllocClaim", amount: "40000000000", ok: true })]);
  b.push(at(42), [c("creator_alloc_claimed", { launch_id: "1", recipient: "alice.testnet", amount: "7000000000" })]);
  b.push(at(43), [
    c("payout_resolved", { launch_id: "1", kind: "AllocClaim", amount: "7000000000", ok: false }),
    c("token_delivery_refused", { launch_id: "1", kind: "AllocClaim", receiver: "alice.testnet", reason: "receiver is not registered on the token" }),
  ]);
  b.push(at(44), [c("stream_lengthened", { launch_id: "1", end_ns: ns(at(44) + 90 * 600), unlocked_at_change: "1200000" })]);
  b.push(at(45), [c("tokens_swept", { launch_id: "2", amount: "900000000", mode: "hold", payer: "keeper.testnet" })]);
  b.push(at(46), [c("tokens_swept", { launch_id: "4", amount: "300000000", mode: "sink:dead.testnet", payer: "keeper.testnet" })]);
  b.push(at(47), [c("payout_resolved", { launch_id: "4", kind: "Sweep", amount: "300000000", ok: true })]);
  b.push(at(48), [c("refund_batch", { launch_id: "2", handled: 2, paid: 1 })]);
  b.push(at(49), [c("refund_route_set", { launch_id: "2", holder: "near:ivy.testnet", amount: "5000000", intents_account: "ivy.intents.testnet" })]);
  b.push(at(50), [c("orphan_credit_refused", { launch_id: "4", holder: "near:kim.testnet", nonce_spent: false })]);
  b.push(at(51), [c("deposit_rejected_refundable", { launch_id: "4", holder: "near:lee.testnet", code: "R_WINDOW_CLOSED" })]);
  b.push(at(52), [c("owed_near_credited", { account: "alice.testnet", amount: "500000000000000000000000" })]);
  b.push(at(53), [c("owed_near_withdrawn", { account: "alice.testnet", amount: "200000000000000000000000" })]);
  b.push(at(54), [c("owed_near_credited", { account: "bob.testnet", amount: "10000000000000000000000" })]);
}

/** DELTA (launch 4): an F0 ceremony is committed, signed in part, aborted by the guardian, reopened by the owner and committed again. */
function genesisEvents(b: OpsTarget, c: Mk, at: At): void {
  const commit = (mode: string): OpsLog =>
    c("genesis_committed", { launch_id: "4", g_pub: hex("1"), mint: hex("2"), merkle_root: hex("3"), genesis_spec_hash: hex("4"), leaf_count: 3, max_total_claim: "60000000", mode });
  b.push(at(60), [commit("F0")]);
  b.push(at(61), [c("f0_message_registered", { launch_id: "4", tx_index: 0, message_sha256: hex("5") })]);
  b.push(at(62), [c("f0_message_registered", { launch_id: "4", tx_index: 1, message_sha256: hex("6") })]);
  b.push(at(63), [c("f0_sign_requested", { launch_id: "4", tx_index: 0 })]);
  b.push(at(64), [c("genesis_aborted", { launch_id: "4", by: "guardian.testnet", reason: "signer offline during the ceremony" })]);
  b.push(at(65), [c("genesis_reopened", { launch_id: "4", by: "owner.testnet" })]);
  b.push(at(66), [commit("F0")]);
  b.push(at(67), [c("f0_message_registered", { launch_id: "4", tx_index: 0, message_sha256: hex("7") })]);
  b.push(at(68), [c("attest_log", { launch_id: "4", attestation_hash: hex("8") })]);
}

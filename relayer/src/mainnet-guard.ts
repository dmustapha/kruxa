import { createHash } from "node:crypto";
import { MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE } from "./cluster.js";

/** Guard rails for a Solana MAINNET genesis. The default is a dry run that prints the plan and stops. A live run needs, together:
 *  the confirm env (cluster.ts), the dry-run switch explicitly OFF, a per-run spend cap, and a typed confirmation of the exact plan. */
export const DRY_RUN_ENV = "KRUXA_SOLANA_DRY_RUN";
export const SPEND_CAP_ENV = "KRUXA_SOLANA_SPEND_CAP_SOL";
/** A cap above this is treated as a typo: one genesis costs about 0.021 SOL. */
export const MAX_SPEND_CAP_LAMPORTS = 500_000_000;
/** The funder's own fee for the one transfer that funds G. */
export const FUND_TX_FEE_LAMPORTS = 5_000;
type Env = Record<string, string | undefined>;

export class MainnetRefusal extends Error {}
/** Thrown by the gate after it printed the plan in dry-run: the caller exits 0, nothing was sent. */
export class DryRunStop extends Error {}

export interface MainnetSettings { dryRun: boolean; capLamports: number | null }

export function solToLamports(text: string): number {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text.trim());
  if (!m) throw new MainnetRefusal(`${SPEND_CAP_ENV}=${text} is not a SOL amount (digits, optional up to 9 decimals)`);
  return Number(m[1]) * 1_000_000_000 + Number((m[2] ?? "").padEnd(9, "0"));
}

/** Dry-run is ON unless the env is exactly "0". Any other value except unset or "1" is refused as ambiguous. */
export function readSettings(env: Env): MainnetSettings {
  const raw = env[DRY_RUN_ENV];
  if (raw !== undefined && raw !== "0" && raw !== "1") throw new MainnetRefusal(`${DRY_RUN_ENV} must be 0 (live) or 1 (dry run), got "${raw}"`);
  const cap = env[SPEND_CAP_ENV];
  const capLamports = cap === undefined || cap === "" ? null : solToLamports(cap);
  if (capLamports !== null && (capLamports <= 0 || capLamports > MAX_SPEND_CAP_LAMPORTS)) {
    throw new MainnetRefusal(`${SPEND_CAP_ENV} must be above 0 and at most ${MAX_SPEND_CAP_LAMPORTS / 1e9} SOL (one genesis costs about 0.021 SOL)`);
  }
  return { dryRun: raw !== "0", capLamports };
}

/** Everything a live run needs before the typed confirmation is even offered. */
export function assertCanSend(s: MainnetSettings, env: Env): number {
  if (env[MAINNET_CONFIRM_ENV] !== MAINNET_CONFIRM_VALUE) throw new MainnetRefusal(`${MAINNET_CONFIRM_ENV} is not ${MAINNET_CONFIRM_VALUE}`);
  if (s.dryRun) throw new MainnetRefusal(`dry run is ON (default); set ${DRY_RUN_ENV}=0 on the command line to send`);
  if (s.capLamports === null) throw new MainnetRefusal(`no spend cap; set ${SPEND_CAP_ENV} (SOL) on the command line`);
  return s.capLamports;
}

export function assertWithinCap(spendLamports: number, capLamports: number): void {
  if (spendLamports > capLamports) throw new MainnetRefusal(`this run would spend ${spendLamports} lamports, over the cap ${capLamports}`);
}

export interface MainnetPlan {
  /** pre-commit: before the one-shot NEAR commit_genesis (cost is an upper bound). pre-send: exact, before G is funded and anything is signed. */
  stage: "pre-commit" | "pre-send";
  cluster: string;
  launchId: string; core: string; signerMode: string; gPub: string; mint: string; funder: string; funderBalance: number;
  fundLamports: number; priceMicroLamports: number; jitoProgram: string; metadataUri: string; capLamports: number | null;
  exact?: { specHash: string; hasDistributor: boolean; metadata: string; reserveMultisig: string; reserveOwner: string; reserveAta: string; distributor: string; vault: string };
}

export const totalSpend = (p: Pick<MainnetPlan, "fundLamports">): number => p.fundLamports + FUND_TX_FEE_LAMPORTS;
const sol = (l: number): string => `${(l / 1e9).toFixed(9)} SOL (${l} lamports)`;

export function renderPlan(p: MainnetPlan): string[] {
  const lines = [
    `=== SOLANA ${p.cluster.toUpperCase()} GENESIS PLAN (${p.stage}) ===`,
    `launch ${p.launchId}   core ${p.core}   signer ${p.signerMode}`,
    `mint (derived, createWithSeed): ${p.mint}`,
    `G (mint authority until sealed, then nothing): ${p.gPub}`,
    `programs: system, compute-budget, Tokenkeg (classic SPL token), ATA, Metaplex Token Metadata, Jito distributor ${p.jitoProgram}`,
    `metadata uri: ${p.metadataUri}   priority fee: ${p.priceMicroLamports} micro-lamports per CU`,
    `funder ${p.funder} holds ${sol(p.funderBalance)}`,
    `spend: ${sol(p.fundLamports)} into G${p.stage === "pre-commit" ? " (upper bound, a distributor is assumed)" : ""} plus ${FUND_TX_FEE_LAMPORTS} lamports fee = ${sol(totalSpend(p))}`,
    `spend cap: ${p.capLamports === null ? "NOT SET" : sol(p.capLamports)}`,
  ];
  if (p.exact) {
    const e = p.exact;
    lines.push(`spec hash ${e.specHash}`, `metadata account ${e.metadata}`, `reserve Squads multisig ${e.reserveMultisig}   vault (reserve owner) ${e.reserveOwner}`, `reserve ATA ${e.reserveAta}`,
      e.hasDistributor ? `distributor ${e.distributor}   vault ATA ${e.vault}` : "no distributor (no Solana buyers)");
  }
  return lines;
}

/** Eight hex characters of the plan text: a different plan needs a different typed answer. */
export const planCode = (p: MainnetPlan): string => createHash("sha256").update(renderPlan(p).join("\n")).digest("hex").slice(0, 8).toUpperCase();

export type CeremonyGate = (plan: MainnetPlan) => Promise<void>;

/** The gate the mainnet CLI hands to runCeremony. Prints the plan; in dry-run stops there; live: checks cap and balance, then needs `MINT <code>` typed back. */
export function makeGate(s: MainnetSettings, env: Env, ask: (q: string) => Promise<string>, out: (l: string) => void): CeremonyGate {
  return async (plan) => {
    const shown = { ...plan, capLamports: s.capLamports };
    for (const l of renderPlan(shown)) out(l);
    if (s.dryRun) throw new DryRunStop(`dry run: nothing was sent (${plan.stage}); rerun with ${DRY_RUN_ENV}=0 and ${SPEND_CAP_ENV} to go live`);
    const cap = assertCanSend(s, env);
    assertWithinCap(totalSpend(plan), cap);
    if (plan.funderBalance < totalSpend(plan)) throw new MainnetRefusal(`funder holds ${plan.funderBalance} lamports, needs ${totalSpend(plan)}`);
    const code = planCode(shown);
    const typed = (await ask(`Type "MINT ${code}" to confirm this ${plan.stage} step, anything else aborts: `)).trim();
    if (typed !== `MINT ${code}`) throw new MainnetRefusal("typed confirmation did not match; nothing was sent");
  };
}

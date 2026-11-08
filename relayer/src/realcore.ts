import type { Account } from "near-api-js";
import { type CoreClient, GenesisRefused } from "./core.js";

const GAS = 200n * 10n ** 12n;
const PAGE = 25;
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

interface Allocation { pubkey: string; amount: string }

/** The real NEAR core (docs/interfaces/REQ-1-genesis-relayer.md): the relayer account must be the core's `genesis_relayer`. */
export class RealCore implements CoreClient {
  label: string;
  constructor(private readonly account: Account, readonly coreId: string) { this.label = `REAL core ${coreId} (NEAR testnet)`; }

  view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    return this.account.viewFunction({ contractId: this.coreId, methodName: method, args }) as Promise<T>;
  }

  async call(method: string, args: Record<string, unknown>): Promise<string> {
    try {
      const out = await this.account.functionCall({ contractId: this.coreId, methodName: method, args, gas: GAS, attachedDeposit: 0n });
      return out.transaction.hash as string;
    } catch (e) {
      const m = String(e instanceof Error ? e.message : e);
      const code = /R_GENESIS_[A-Z]+|R_NOT_AUTHORIZED/.exec(m)?.[0];
      if (code) throw new GenesisRefused(code);
      throw e;
    }
  }

  async allocations(id: bigint): Promise<Array<[string, string]>> {
    const st = await this.view<{ holder_count: number }>("get_state", { launch_id: id.toString() });
    const all: Allocation[] = [];
    for (let from = 0; from < st.holder_count; from += 50) {
      all.push(...(await this.view<Allocation[]>("solana_allocations_page", { launch_id: id.toString(), from_seq: from, limit: 50 })));
    }
    return all.sort((a, b) => a.pubkey.localeCompare(b.pubkey)).map((a) => [a.pubkey, a.amount]);
  }

  async commitGenesis(launchId: bigint, gPub: Uint8Array): Promise<void> {
    const id = launchId.toString();
    const leaves = await this.allocations(launchId);
    await this.call("commit_genesis", { launch_id: id, g_pub: hex(gPub) });
    for (let i = 0; i < leaves.length; i += PAGE) await this.call("build_root_page", { launch_id: id, leaves: leaves.slice(i, i + PAGE) });
    const g = await this.view<{ root_ready: boolean }>("get_genesis", { launch_id: id });
    if (!g.root_ready) throw new Error("core did not report root_ready after the last page");
  }

  async specBytes(launchId: bigint): Promise<Uint8Array> {
    const b64 = await this.view<string | null>("get_genesis_spec", { launch_id: launchId.toString() });
    if (!b64) throw new Error("core has no committed spec yet");
    return Uint8Array.from(Buffer.from(b64, "base64"));
  }

  async specHashOnChain(launchId: bigint): Promise<string> {
    return (await this.view<{ genesis_spec_hash: string }>("get_genesis", { launch_id: launchId.toString() })).genesis_spec_hash;
  }

  async confirmGenesis(launchId: bigint, mint: Uint8Array, sigs: string[], slot: number, ceremonyHash: string): Promise<void> {
    await this.call("confirm_genesis", { launch_id: launchId.toString(), mint: hex(mint), sigs, slot: slot.toString(), ceremony_hash: ceremonyHash });
  }

  async abortGenesis(launchId: bigint, reason: string): Promise<void> {
    await this.call("abort_genesis", { launch_id: launchId.toString(), reason: reason.slice(0, 200) });
  }
}

import { FallbackSource, RpcSource, httpRpc } from "../../indexer/src/rpc.ts";
import { NeardataSource } from "../../indexer/src/sources.ts";
import type { BlockSource } from "../../indexer/src/types.ts";

export interface SourceOptions {
  /** Override of the neardata base URL (a mirror or proxy). Default is https://<network>.neardata.xyz. */
  neardataUrl?: string;
  /** NEAR JSON-RPC endpoint; when set, a block scan over it backs up neardata. */
  rpcUrl?: string;
  rpcOnly?: boolean;
  rpcScanAll?: boolean;
}

/** neardata alone, or neardata backed by an RPC block scan when an RPC url is set (rpcOnly drops neardata). */
export function buildSource(network: string, accounts: string[], opts: SourceOptions = {}): BlockSource {
  const neardata = new NeardataSource(network, opts.neardataUrl ? { base: opts.neardataUrl.replace(/\/$/, "") } : {});
  if (!opts.rpcUrl) return neardata;
  const rpc = new RpcSource(network, httpRpc(opts.rpcUrl), { accounts, scanAllTransactions: opts.rpcScanAll === true });
  return opts.rpcOnly ? rpc : new FallbackSource(neardata, rpc);
}

import { readFileSync } from "node:fs";
import { connect, KeyPair, keyStores, providers } from "near-api-js";
import type { KeeperConfig } from "./config.js";
import type { CallResult, Chain } from "./types.js";

const TGAS = 10n ** 12n;
type SecretKey = `ed25519:${string}`;

/** Read-only view client: needs no key. */
export function nearViews(cfg: Pick<KeeperConfig, "rpcUrl" | "core">): Pick<Chain, "view"> {
  const provider = new providers.JsonRpcProvider({ url: cfg.rpcUrl });
  return {
    view: async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
      const res = await provider.query({
        request_type: "call_function", account_id: cfg.core, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic",
      });
      const bytes = (res as unknown as { result: number[] }).result;
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
    },
  };
}

/** Accepts the relayer key file ({account_id, secret_key}), a near-cli credentials file ({account_id, private_key}), or a bare key in env. */
export function readSecretKey(cfg: Pick<KeeperConfig, "keyFile" | "keyEnv" | "accountId">): SecretKey {
  let key: string | undefined = cfg.keyEnv;
  if (cfg.keyFile) {
    const f = JSON.parse(readFileSync(cfg.keyFile, "utf8")) as { account_id?: string; secret_key?: string; private_key?: string };
    if (f.account_id && f.account_id !== cfg.accountId) throw new Error(`key file belongs to ${f.account_id}, not KEEPER_ACCOUNT_ID ${cfg.accountId}`);
    key = f.secret_key ?? f.private_key;
  }
  if (!key?.startsWith("ed25519:")) throw new Error("no ed25519 key: set KEEPER_KEY_FILE or KEEPER_KEY");
  return key as SecretKey;
}

const ruleCode = (m: string): string | undefined => /R_[A-Z0-9_]+/.exec(m)?.[0];

/** Signing client. Contract refusals come back as { ok: false, code }; transport errors (429, timeouts) are thrown for the backoff layer. */
export async function nearSigner(cfg: KeeperConfig): Promise<Pick<Chain, "call">> {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", cfg.accountId, KeyPair.fromString(readSecretKey(cfg)));
  const near = await connect({ networkId: "testnet", nodeUrl: cfg.rpcUrl, keyStore });
  const account = await near.account(cfg.accountId);
  return {
    call: async (method, args, gasTgas): Promise<CallResult> => {
      try {
        const out = await account.functionCall({ contractId: cfg.core, methodName: method, args, gas: BigInt(gasTgas) * TGAS, attachedDeposit: 0n });
        return { ok: true, tx: out.transaction.hash as string };
      } catch (e) {
        const error = String(e instanceof Error ? e.message : e);
        const code = ruleCode(error);
        if (!code && /429|too many requests|timeout|ECONN|fetch failed/i.test(error)) throw e;
        return { ok: false, code, error: error.slice(0, 300) };
      }
    },
  };
}

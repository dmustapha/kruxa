import { parseArgs } from "node:util";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { BaseFeeMode } from "@meteora-ag/cp-amm-sdk";
import { DEFAULT_RPC, assertClusterMatches, assertNetworkAllowed, type Network } from "./network.js";
import { DEFAULT_SCHEDULER, type PoolProposalParams } from "./params.js";
import { buildPoolPlan } from "./plan.js";

const USAGE = `kruxa-venue build-pool-proposal [options]   (builds an UNSIGNED DAMM v2 pool plan; never signs or sends)

  --base-mint <pk>        plain SPL mint, null mint and freeze authority (required)
  --quote-mint <pk>       USDC mint (required)
  --seed-base <raw>       base amount in raw units (required)
  --seed-quote <raw>      quote amount in raw units (required)
  --owner <pk>            position owner and creator, the Squads vault (required)
  --payer <pk>            defaults to --owner
  --position-nft <pk>     position NFT mint address; its signer is supplied at execution (required)
  --network <n>           devnet (default) | localnet | mainnet
  --rpc <url>             override RPC; cluster genesis hash must match --network
  --fee-start-bps <n>     default ${DEFAULT_SCHEDULER.startBps}
  --fee-end-bps <n>       default ${DEFAULT_SCHEDULER.endBps}
  --fee-periods <n>       default ${DEFAULT_SCHEDULER.periods}
  --fee-duration-sec <n>  default ${DEFAULT_SCHEDULER.durationSec}
  --fee-mode <m>          linear (default) | exponential
  --activation-ts <unix>  default: active at creation
  --no-lock               skip permanent lock (spike use only)
  --json                  print the plan as JSON
  --mainnet-i-know        with env DAMI_PER_ACTION_CONFIRMED, required for --network mainnet`;

const OPTIONS = {
  "base-mint": { type: "string" }, "quote-mint": { type: "string" },
  "seed-base": { type: "string" }, "seed-quote": { type: "string" },
  owner: { type: "string" }, payer: { type: "string" }, "position-nft": { type: "string" },
  network: { type: "string", default: "devnet" }, rpc: { type: "string" },
  "fee-start-bps": { type: "string" }, "fee-end-bps": { type: "string" },
  "fee-periods": { type: "string" }, "fee-duration-sec": { type: "string" },
  "fee-mode": { type: "string", default: "linear" }, "activation-ts": { type: "string" },
  "no-lock": { type: "boolean", default: false }, json: { type: "boolean", default: false },
  "mainnet-i-know": { type: "boolean", default: false }, help: { type: "boolean", default: false },
} as const;

type Parsed = ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>["values"];

function need(v: string | undefined, name: string): string {
  if (!v) throw new Error(`missing --${name}`);
  return v;
}

function toNetwork(v: string): Network {
  if (v === "devnet" || v === "mainnet" || v === "localnet") return v;
  throw new Error(`unknown --network ${v}`);
}

function toUint(v: string | undefined, fallback: number, name: string): number {
  if (v === undefined) return fallback;
  if (!/^\d+$/.test(v)) throw new Error(`--${name} must be a non-negative integer`);
  return Number(v);
}

function toBn(v: string, name: string): BN {
  if (!/^\d+$/.test(v)) throw new Error(`--${name} must be a raw integer amount`);
  return new BN(v);
}

export function toParams(v: Parsed): PoolProposalParams {
  const owner = new PublicKey(need(v.owner, "owner"));
  const exp = v["fee-mode"] === "exponential";
  return {
    network: toNetwork(v.network),
    baseMint: new PublicKey(need(v["base-mint"], "base-mint")),
    quoteMint: new PublicKey(need(v["quote-mint"], "quote-mint")),
    seedBase: toBn(need(v["seed-base"], "seed-base"), "seed-base"),
    seedQuote: toBn(need(v["seed-quote"], "seed-quote"), "seed-quote"),
    owner,
    payer: v.payer ? new PublicKey(v.payer) : owner,
    positionNft: new PublicKey(need(v["position-nft"], "position-nft")),
    fee: {
      startBps: toUint(v["fee-start-bps"], DEFAULT_SCHEDULER.startBps, "fee-start-bps"),
      endBps: toUint(v["fee-end-bps"], DEFAULT_SCHEDULER.endBps, "fee-end-bps"),
      periods: toUint(v["fee-periods"], DEFAULT_SCHEDULER.periods, "fee-periods"),
      durationSec: toUint(v["fee-duration-sec"], DEFAULT_SCHEDULER.durationSec, "fee-duration-sec"),
      mode: exp ? BaseFeeMode.FeeTimeSchedulerExponential : BaseFeeMode.FeeTimeSchedulerLinear,
    },
    activationTimestamp: v["activation-ts"] === undefined ? null : toUint(v["activation-ts"], 0, "activation-ts"),
    lockLiquidity: !v["no-lock"],
  };
}

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd !== "build-pool-proposal") {
    console.error(USAGE);
    process.exitCode = cmd === undefined || cmd === "--help" ? 0 : 2;
    return;
  }
  const { values } = parseArgs({ args: rest, options: OPTIONS });
  if (values.help) return console.log(USAGE);
  const network = toNetwork(values.network);
  assertNetworkAllowed({ network, mainnetIKnow: values["mainnet-i-know"], env });
  const params = toParams(values);
  const connection = new Connection(values.rpc ?? DEFAULT_RPC[network], "confirmed");
  await assertClusterMatches(connection, network);
  const plan = await buildPoolPlan(connection, params);
  console.log(values.json ? JSON.stringify(plan, null, 2) : summarize(plan));
}

function summarize(plan: Awaited<ReturnType<typeof buildPoolPlan>>): string {
  const ixs = plan.instructions.map((i, n) => `  ${n + 1}. ${i.label}`).join("\n");
  return `network ${plan.network}\npool ${plan.pool}\nposition ${plan.position}\ninstructions:\n${ixs}\nrequired signers:\n` +
    plan.requiredSigners.map((s) => `  ${s.pubkey} (${s.role})`).join("\n");
}

main(process.argv.slice(2), process.env).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});

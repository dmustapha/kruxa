// Open limits, written once and quoted by the Security page and the Risk page. Source: docs/KNOWN-FINDINGS.md, the launcher review
// (REVIEW-INSTANT-LAUNCH, L-04 and L-06), the remaining-work list (N-04, N-06) and the core contract (contracts/core/src/govern.rs,
// token_claims.rs, solvency.rs, genesis.rs). Plain words first; each entry says what is true, what is not proven and why it matters.
// content.test.ts lints this text with the same rules as the pages (no dashes, no banned words, no overclaims).
export interface OpenLimit { id: string; title: string; text: string }

export const OPEN_LIMITS: OpenLimit[] = [
  {
    id: 'N-04', title: 'Retrying a token hand-over depends on the token refunding storage',
    text: 'Handing tokens to an account that is not yet registered on the token needs a 0.00125 NEAR storage deposit. If that hand-over fails and is retried, the retry works only if the token contract gives back the unused storage deposit. This is behaviour of the token contract, not of Kruxa. The registration itself was checked against the real token factory on NEAR testnet (evidence/instant-testnet). The refund on a retry is not proven, and has not been seen on mainnet. A different token code could behave differently.',
  },
  {
    id: 'N-06', title: 'The launcher profile check relies on account names that are not verified on mainnet',
    text: 'The Instant launcher refuses a profile that does not fit its own account name: the mainnet profile needs a .near account, and the testnet and demo profiles need a .testnet or .localnet one. That check helps only if those names cannot be used to mislabel a deployment. Who controls test.near, testnet and localnet on mainnet has not been checked. The check is a read-only lookup that is still open.',
  },
  {
    id: 'L-04', title: 'The self-buy block catches only declared wallets',
    text: 'On an Instant launch the market refuses buys from the creator account and the payout recipient. It does not stop a second wallet, a buy routed through another contract, or a fresh account that later sends tokens to the creator. It is not protection against insiders and is not sybil resistance.',
  },
  {
    id: 'L-06', title: 'The factory owner can replace token code',
    text: 'Launch tokens come from a factory whose global contract has an owner key. That owner can update the token code, and Kruxa cannot see that on chain. A malicious update could affect every factory token, including the tokens traded in Kruxa pools. The fix, publishing a token by fixed hash, is not approved.',
  },
  {
    id: 'KEY', title: 'The phase-0 owner key and the 7 day upgrade delay',
    text: 'One person holds the owner key of the core contract in phase 0. The core can only be upgraded through a public queue: the owner queues a code hash, 7 days must pass, then the owner deploys code that matches the hash, and the guardian can cancel a queued upgrade. Whether the account also still holds a full-access key is printed by the verifier on its KEYS line. There is no multisig and no independent signer yet.',
  },
  {
    id: 'HALT', title: 'The owner or guardian can halt a launch',
    text: 'halt_launch stops new commits and the creator side payouts of one launch. It cannot block Walk, refunds or token claims, and it cannot change a verdict, so it can only turn a launch toward FAIL. Only the owner can resume a halted launch.',
  },
  {
    id: 'FORCE', title: 'The owner can force-resolve a stuck payout leg after 48 hours',
    text: 'force_resolve_op settles one outbound payout whose callback never ran, in two steps with the same arguments, 48 hours apart. It can move at most what is in flight, to no new destination, and it never touches a verdict.',
  },
  {
    id: 'SOLV', title: 'The solvency report is informational',
    text: 'Anyone can run check_solvency. It moves no money. If the Intents balance of the core contract is below what it owes there, the contract raises an alert that pauses new Intents commits. Exits stay open. A report that looks fine does not prove that every balance is covered.',
  },
  {
    id: 'BURN', title: 'Unclaimed tokens are held, not burned',
    text: 'sweep_tokens releases supply that nobody is owed. The default burn mode is Hold, which marks that supply as held and moves nothing. The factory token has no burn method, so burning is refused. The owner can choose a sink account once, and a sink cannot be a Kruxa controlled account.',
  },
  {
    id: 'F0', title: 'The F0 genesis path signs through a contract gate',
    text: 'For the F0 path, the core contract registers the hash of each Solana message and signs only a message that matches a registered hash (register_f0_message, then sign_genesis). This limits what the signing key can be asked to sign. It has not run on mainnet, and a single-use genesis key is still trusted for one session.',
  },
  {
    id: 'FROZEN', title: 'A freeze can block exits until it expires',
    text: 'A guardian freeze can block exits, including a Walk. The 7 day expiry is a pure function of the stored freeze time that the contract applies whenever it reads its pause level, so no transaction is needed to lift it. It is a disclosed limit that was only exercised in a local sandbox, not on a live network.',
  },
];

export const limitById = (id: string): OpenLimit => {
  const l = OPEN_LIMITS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown limit ${id}`);
  return l;
};

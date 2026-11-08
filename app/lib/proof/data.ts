// Proof artifacts shown on /proof. Every row carries its own honest label and the document it was copied from. Nothing here is
// computed or invented: rows are transcriptions of PROOF-DEBTS.md, INVARIANTS.md, PRD 7.6 and spikes/meteora/RESULTS.md as of 2026-11-08.
// The Test 1 evidence FILES are not committed yet (PD-6), so those rows say RECORDED (from the docs), never LIVE.

export type ProofStatus = 'PROVEN' | 'SOURCE-READ' | 'UNPROVEN';

export interface ProofRow { id: string; title: string; status: ProofStatus; detail: string; next: string; owner?: string }

/** PROOF-DEBTS.md, updated 2026-11-08. Status mapping is conservative: a debt is PROVEN only where the doc says a live run happened. */
export const PROOF_TABLE: ProofRow[] = [
  { id: 'OV4', title: 'Intents deposit credit (SOL deposit credited as USDC)', status: 'PROVEN', detail: 'Ran live 2026-11-08: 0.002 SOL via a 1Click quote credited 0.17742 USDC in about 90 s; a SOL deposit to a Solana-USDC omft credit credited 0.131942 USDC in 97 s. Evidence file evidence/test1-ov4.json is not committed yet (PD-6).', next: 'Commit the evidence file (PD-6).' },
  { id: 'OV15', title: 'Intents ft_withdraw to a Solana address', status: 'PROVEN', detail: 'Ran live on mainnet 2026-11-08: 60000 micro-USDC withdrawn, 30000 landed; the fixed 0.03 USDC bridge fee is the difference. Evidence file evidence/test1-ov15.json is not committed yet (PD-6).', next: 'Commit the evidence file (PD-6).' },
  { id: 'T0-T5', title: 'Chain Signatures: derivation, mainnet transfer, 20 of 20 signatures, 1,150-byte payload, devnet genesis-shaped mint, policy-gated sign', status: 'PROVEN', detail: 'Recorded in the signed-tests state (not read by this build). p50 13.5 s, p95 15.1 s. No mainnet mint and no Kruxa genesis was signed by F0.', next: 'Mainnet F0 only inside the Genesis Round after the gate (PD-9).' },
  { id: 'PD-10', title: 'Meteora DAMM v2 on devnet', status: 'PROVEN', detail: 'Devnet run 2026-11-08 with signatures (table below). Open: PDA-owned position of Kruxa\'s own program, delegate claim, DBC checks, indexer listing.', next: 'Finish the open sub-checks.' },
  { id: 'PD-1', title: 'A real wallet connects through near-connect and signs a testnet create, commit and claim', status: 'UNPROVEN', detail: 'The wallet layer is tested with mocks only. This app has never signed with a real wallet.', next: 'Manual browser test with a real NEAR wallet on testnet (Dami + builder).', owner: 'D + A' },
  { id: 'PD-2', title: 'OV3: Phantom signMessage byte-exactness for the Intents raw_ed25519 payload', status: 'UNPROVEN', detail: 'Never run with a real Phantom. Every Solana-only commit and walk in this app is labelled UNPROVEN for that reason.', next: 'Small test page, Phantom signs, verifier recomputes the intent hash.', owner: 'D + A' },
  { id: 'PD-3', title: 'Solflare and Backpack signMessage', status: 'UNPROVEN', detail: 'Only Phantom is in scope for OV3. Default wording: Phantom verified (after PD-2), Solflare and Backpack unverified.', next: 'Test each or state unverified.', owner: 'D + A' },
  { id: 'PD-4', title: 'near-connect loads its wallet manifest and code from remote hosts in sandboxed iframes', status: 'SOURCE-READ', detail: 'Read in the library source; the unreachable-host error path is not exercised end to end. Disclosed as a supply-chain surface.', next: 'Disclose in SECURITY.md and HONESTY.md; test the offline path.', owner: 'A' },
  { id: 'PD-5', title: 'Wallet UI at 375 px with the chooser open', status: 'UNPROVEN', detail: 'Headless screenshots only. Not checked on a real phone.', next: 'Phone-width check on real pages.', owner: 'A + D' },
  { id: 'PD-6', title: 'Test 1 evidence files committed (test1-ov4.json, test1-ov15.json)', status: 'UNPROVEN', detail: 'The runs happened; the files are not in the repo, so the receipts cannot be re-read by a stranger yet.', next: 'Copy results read-only from signed-tests state; scrub secrets.', owner: 'A' },
  { id: 'PD-7', title: 'FROZEN 7-day auto-expiry', status: 'SOURCE-READ', detail: 'Tested as a pure function only. No on-chain run.', next: 'State-patch test or carry as a disclosed limitation.', owner: 'A' },
  { id: 'PD-8', title: 'S3 against the real intents.near wasm', status: 'UNPROVEN', detail: 'Mock Intents only so far.', next: 'PLAN Task 2.3.', owner: 'A' },
  { id: 'PD-9', title: 'F0 genesis rehearsals (three on NEAR testnet plus Solana devnet) and F0 on mainnet', status: 'UNPROVEN', detail: 'Not run yet. No genesis rehearsal evidence is committed, so none is shown below.', next: 'PLAN Task 4.6; mainnet only after the Nov 10 gate.', owner: 'A (D confirms mainnet)' },
  { id: 'PD-11', title: 'Token factory cost: 0.05 USDC or 2.36 NEAR', status: 'UNPROVEN', detail: 'The specs conflict.', next: 'Testnet factory probe.', owner: 'A' },
  { id: 'PD-12', title: 'verify.sh KEYS and CODE lines and live-chain tamper runs', status: 'UNPROVEN', detail: 'Built in the repo (E-4, E-5) but not yet run against a deployed contract with recorded output.', next: 'PLAN Phase 4 Task 4.9.', owner: 'A' },
  { id: 'PD-13', title: 'Solver latency tail on Intents', status: 'SOURCE-READ', detail: 'One swap stalled about 35 minutes before completing; typical legs took 90 to 97 s. Seen once, so it is disclosed, not characterised.', next: 'Funds-in-motion strip (this app) and disclosure.', owner: 'A' },
  { id: 'PD-15', title: 'Dashboard rendering of the thesis pack in a browser', status: 'UNPROVEN', detail: 'SVGs parse as XML only.', next: 'Open the dashboard and review.', owner: 'D' },
];

export interface Test1Row { id: string; what: string; result: string; tx?: { kind: 'near' | 'sol'; value: string; cluster?: 'mainnet' | 'devnet' }; label: 'RECORDED' }

/** Test 1 as RECORDED in INVARIANTS.md (TEST 1 RESULT block, 2026-11-08). Evidence files not committed (PD-6): these are not LIVE reads. */
export const TEST1_ROWS: Test1Row[] = [
  { id: 'OV4-a', what: 'SOL to USDC deposit through a 1Click quote', result: '0.002 SOL credited 0.17742 USDC in about 90 s', label: 'RECORDED' },
  { id: 'OV4-b', what: 'SOL deposit to a Solana-USDC omft credit', result: 'credited 0.131942 USDC in 97 s', label: 'RECORDED' },
  { id: 'OV15', what: 'intents.near ft_withdraw to a fresh Solana address', result: '60000 micro-USDC withdrawn, 30000 landed (fixed 0.03 USDC bridge fee)', tx: { kind: 'near', value: '3KLVemdjr387BsqJiuuV9By9VXzeri6GRFwy3HMRT6ko', cluster: 'mainnet' }, label: 'RECORDED' },
  { id: 'LAT', what: 'Earlier 0.05 USDC (NEAR) to Solana-USDC 1Click swap', result: 'solver stalled about 35 minutes, then completed (SUCCESS, 0.049988 omft credited)', label: 'RECORDED' },
];

export interface ChainSigRow { id: string; what: string; value: string; tx?: { kind: 'near' | 'sol'; value: string; cluster: 'mainnet' | 'devnet' } }

/** PRD 7.6 chain-signatures table, transcribed. Source state file warroom/signed-tests/state/test2.json was not read here. */
export const CHAIN_SIG_ROWS: ChainSigRow[] = [
  { id: 'T0', what: 'Derived key matches the expected address', value: 'derivation match' },
  { id: 'T1a', what: 'Funding transfer for the MPC-derived key', value: 'Solana mainnet', tx: { kind: 'sol', value: '2VMcLc3Ff7KMd23dBcawyQW7xy4pTzDPjqfD3TfogeUVTMKZRUKnNEtBVDvG2fSuM2BVaa5eL7qa3N2AZ3bSU9iR', cluster: 'mainnet' } },
  { id: 'T1b', what: 'Transfer signed by the MPC-derived key', value: 'Solana mainnet', tx: { kind: 'sol', value: '2AJfSjNKfCrdw6fN7DM1XKDrrCsbbgu4hz9ULBUWNna9QrbarLnMTxBiyEFkKr5adXon4qiWUfsEUVvrHqmKuwWd', cluster: 'mainnet' } },
  { id: 'T2', what: 'Signature latency', value: '20 of 20 signed, p50 13.5 s, p95 15.1 s' },
  { id: 'T3', what: 'Payload size accepted', value: '1,150 bytes' },
  { id: 'T4', what: 'Devnet genesis-shaped mint, six checks true, null authorities', value: 'rktRrftPETTotHEf3jLTPSJQ1bPv6oFoBQFGEQzhEHz' },
  { id: 'T5a', what: 'T5 deploy (code hash 2VGQJw5MG5yQ7ZN7HfFKRvY7nFcUvJNAgSofb56Es8oC)', value: 'NEAR mainnet', tx: { kind: 'near', value: '3HVLFJ5ussoJktiqeLyEGvxNTsobUogHhP7T7rASfv4f', cluster: 'mainnet' } },
  { id: 'T5b', what: 'T5 NEAR mainnet transaction (listed in PRD 7.6)', value: 'NEAR mainnet', tx: { kind: 'near', value: 'E9w896pZfi4oJimEhctMMq32HhuK3Q8Anpnu3CTbruGd', cluster: 'mainnet' } },
  { id: 'T5c', what: 'T5 NEAR mainnet transaction (listed in PRD 7.6)', value: 'NEAR mainnet', tx: { kind: 'near', value: '9GCxnLUubUrpJqvDrfyhLc3hga45rZSreJ46jzcmGDZn', cluster: 'mainnet' } },
  { id: 'T5d', what: 'A mismatched message is refused by the policy gate', value: 'refusal recorded' },
];

/** Strings that must not appear in this app until a committed run produces them (INVARIANTS MUST NOT CLAIM, CO-6 E-1/E-7). */
export const FORBIDDEN_STRINGS = ['GALLERY 13/13', 'injection: model complied 7/20', 'RECEIPTS OK n=10 level=L1'] as const;

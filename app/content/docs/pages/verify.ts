import type { Page } from '../../types';
import { code, h2, h3, note, ol, p, table, ul } from '../../blocks';

export const verify: Page = {
  slug: 'verify',
  title: 'Verify a launch',
  group: 'Trust',
  summary: 'Recompute a verdict yourself, with no wallet and no funds, and know what each exit code means.',
  blocks: [
    p('You do not need to trust the website. The verdict depends on three recorded numbers, and a script in the repository recomputes it from public chain state. A browser version of the same recompute is on the [verify page](/demo).'),
    h2('Run it'),
    p('From the root of the repository. These commands are in `scripts/verify.sh`.'),
    code(`# Offline: recompute the documented boundary vectors. No network.
./scripts/verify.sh golden

# A launch by id. Reads public views from the NEAR RPC, recomputes the verdict,
# and prints the KEYS and CODE lines. Defaults to testnet and core.kruxa.testnet.
./scripts/verify.sh <launch_id>

# Flip one recorded input per run. Every run must exit 2 and print MISMATCH <field>.
./scripts/verify.sh <launch_id> --tamper-all

# Read every view from a second RPC too. Disagreement is an infrastructure error.
./scripts/verify.sh <launch_id> --rpc2 <url>

# Replay recorded Solana responses with no network. Prints "RECORDED, not live".
./scripts/verify.sh --evidence FILE`),
    p('Environment variables: `KRUXA_NEAR_RPC` (NEAR RPC URL), `KRUXA_CONTRACT` (the core account) and `SOL_DEVNET_RPC`. The script needs Python 3 and a Rust toolchain for `kruxa-sim`.'),
    h2('Expected output on the golden vectors'),
    ul(
      'Total equal to the soft cap with the minimum backers prints `outcome=PASS`.',
      'One micro-USDC below the soft cap prints `outcome=FAIL(reasons=1)`.',
      'The oversubscription example prints `spend=40000000 refund=60000000` for a 100 USDC buyer.',
    ),
    note('info', 'These are the expected strings listed in CLAIMS.md. The repository lists each claim as UNVERIFIED until `scripts/verify-claims.sh` prints PASS for it. Run the commands yourself.', 'Claims ledger'),
    h2('Exit codes'),
    table(
      ['Code', 'Meaning', 'What to do'],
      ['0', 'MATCH. Every check passed.', 'Nothing. The recomputed values equal the recorded ones.'],
      ['1', 'A tamper run was **not** detected (`TAMPER NOT DETECTED <field>`).', 'The verifier itself failed its self-test. Do not trust its output. Report it.'],
      ['2', '**MISMATCH.** Only a real difference exits 2, and a `MISMATCH <field>` line names the field.', 'The recorded state and the recomputed state disagree. Treat the launch as suspect.'],
      ['3', 'Pending. The launch is not settled yet, or a genesis record is not published yet.', 'Wait, then run again.'],
      ['4', 'Network or view failure: dead RPC, two RPCs disagreeing, or an unparsable answer.', 'Retry or use another RPC. An infrastructure problem is never turned into a pass, and never into exit 2.'],
      ['64', 'Usage error: a missing or unknown argument.', 'Read the usage line it printed.'],
    ),
    p('When several parts run, the worst code wins in this order: 4, then 1, then 64, then 2, then 3, then 0. A broken network anywhere cannot hide behind a clean part.'),
    h2('What it checks'),
    h3('NEAR side'),
    ul(
      'The verdict is recomputed from total active commits, active backers and the cancelled flag, and compared with the stored outcome.',
      'The book hash is recomputed from the recorded events.',
      'The `KEYS` line lists the full-access keys on the core account. The `CODE` line compares the on-chain code hash to the reproducible build hash. These lines are listed as not yet built in PROOF-DEBTS.md (PD-12), so a run today may not print them.',
    ),
    h3('Solana side (after a PASS)'),
    ul(
      'The mint account exists, is owned by the classic Token program and is 82 bytes.',
      'Mint authority and freeze authority are none, and there are no token extensions.',
      'Supply is conserved across the buckets.',
      'For a FAIL, the Solana address is absent and no genesis was committed.',
    ),
    note('warn', 'Do not read "immutable", "no admin key" or "the operator cannot change the rules" into a green run. Those sentences hold only if the `KEYS` line prints zero full-access keys, or a timelocked upgrade path, and the `CODE` line prints MATCH. With a full-access key present, the honest reading is the KEYS line itself.', 'What a pass does not say'),
    h2('If you cannot install anything'),
    p('The project lists a `make judge` path that runs from committed, hash-pinned artifacts. It is not yet proven in a clean container, so treat it as planned until its evidence file is committed.'),
    ol(
      'Open the [no-wallet verify page](/demo) in the app.',
      'Read the launch page. It shows the three verdict inputs and the margin to PASS.',
      'Compare them with the chain yourself through a public NEAR RPC view.',
    ),
  ],
};

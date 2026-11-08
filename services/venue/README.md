# kruxa-venue

Builds an UNSIGNED Meteora DAMM v2 pool-creation plan for a Squads proposal. It never signs and never sends.

```
cd services/venue && npm install
node bin/kruxa-venue.mjs build-pool-proposal --json \
  --base-mint <plain SPL mint> --quote-mint <USDC> \
  --seed-base <raw> --seed-quote <raw> \
  --owner <Squads vault> --position-nft <NFT mint address> [--network devnet|localnet]
```

Output (`kruxa-venue/pool-plan/1`): pool, position, instructions (programId, keys, base64 data), required signers, an unsigned base64 transaction, base fee schedule.
The position NFT signer is not generated here: pass a keypair at execution, or the Squads ephemeral signer PDA (index 0 of the vault transaction).

Safety rules
- Default network is devnet. The RPC genesis hash must match the declared network.
- `--network mainnet` is refused unless `--mainnet-i-know` AND env `DAMI_PER_ACTION_CONFIRMED` are both set. Even then the tool only prints a plan.
- The base mint must be classic SPL with null mint and freeze authority, else the plan is refused.
- Fee mode is OnlyB: fees accrue in the quote token, so the quote mint is passed as token B regardless of address order.

Tests: `npm test`. Typecheck: `npm run typecheck`.

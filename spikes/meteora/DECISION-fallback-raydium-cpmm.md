# Decision record: fallback venue is Raydium CPMM (DN-22)

Status: adopted for planning. Source: research_notes/Kruxa launchpad market layer fees/meteora_fallback.md (section 7), ARCHITECTURE 5.10.
Scope: the later Solana pool only. Round one seeds the NEAR pool (DN-14).

## Decision
Primary: Meteora DAMM v2 customizable pool, fee mode OnlyB, permanently locked position, decaying base-fee scheduler.
First fallback: Raydium CPMM plus Burn and Earn locker (Fee Key NFT).
Second fallback: Orca Whirlpools splash pool (full range, Orca lock). Rejected: an own pool program.

## Switch triggers (any one flips Solana to Raydium CPMM)
1. Mint rejected by DAMM v2, or the pool cannot be built with SDK 1.5.1 after one working day of debugging. Ask once in the Meteora dev Telegram, then switch. Cost: 2 to 4 days.
2. Permanent lock fails, or fees are not claimable from the locked position. If the only failure is a PDA or Squads owner, first keep the position under a plain relayer-controlled key and sweep fees (no switch). If locking itself fails, switch. Cost: 2 to 4 days.
3. Visibility: after a tiny mainnet pool, Jupiter does not route or DexScreener/GeckoTerminal do not list within about 24 hours. First try Jupiter token info submission, then switch. Cost: 1 to 3 days.
4. Program risk: Meteora announces an exploit, pauses pools (set_pool_status), or ships a breaking upgrade before launch. Cost: 2 to 4 days.
5. Both Meteora and Raydium CPMM fail: Orca Whirlpool full-range with Orca lock, 4 to 7 days, lock callability unverified.

Not triggers (no switch): fee split unusable on locked positions (fall back to one claimer plus Kruxa payout); scheduler params rejected (launch without anti-sniper at the $1,000 cap).

## Status of triggers after the spike (see RESULTS.md)
Triggers 1 and 2 did not fire on the localnet rehearsal (devnet program binary) [see RESULTS.md for devnet status]. Triggers 3 and 4 are untestable on devnet and stay [UNVERIFIED].

## What switching costs Kruxa
- Raydium CPMM creation fee 0.15 SOL (about 0.19 SOL with rent) vs measured 0.0226 SOL for DAMM v2 [UNVERIFIED secondary for Raydium].
- Raydium creator fee is opt-in per AmmConfig (0.05% of volume to the pool creator); distribution is Kruxa-side.
- No anti-sniper tool found for CPMM.
- Lock is Burn and Earn; the Fee Key NFT is the claim credential. PDA or multisig holder is plausible but untested.
- SDK @raydium-io/raydium-sdk-v2 0.2.84-alpha is alpha-tagged. Re-spike lock and claim on devnet before relying on it.
- Devnet program ids conflict across Raydium pages (CPMM DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb; locker DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX vs DLockwT7X7s...). Resolve before building.

## Shared consequences either way
Neither venue has a platform/creator fee split. Kruxa does the split itself (two locked positions with different owners, or one claimer plus a payout leg). Upgrade authorities of Meteora, Raydium and Orca are held by third parties and are not immutable; disclose in LIMITATIONS.

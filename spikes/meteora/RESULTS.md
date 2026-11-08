# Meteora DAMM v2 spike results (S-2)

Run date 2026-11-08. SDK @meteora-ag/cp-amm-sdk 1.5.1, IDL 0.2.5, program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG.

## Status key
- [VERIFIED-DEVNET]: ran on Solana devnet, tx signature given. NONE YET: the devnet spike keypair has 0 SOL and the public faucet is closed. Run `services/venue && npx tsx ../../spikes/meteora/src/spike.ts devnet` once funded (see "To finish on devnet").
- [REHEARSED-LOCAL]: ran the same script on a local solana-test-validator loaded with the DAMM v2 and Squads v4 binaries dumped from devnet (`solana program dump`). Same program bytecode, not the devnet cluster. Signatures below exist only in that throwaway ledger and cannot be looked up on any explorer. Treat as strong evidence the devnet run will pass, NOT as a devnet result. Raw rows: `results.localnet.committed.json`.
- [UNVERIFIED]: not run, taken from docs or inference.

## Spike table

| ID | Check | Devnet | Local rehearsal | Evidence (local ledger) |
|---|---|---|---|---|
| (a) / DM-1 | Pool from an externally created plain SPL mint (mint and freeze authority null) plus 6-decimal test USDC, permanent-lock mode | [UNVERIFIED] pending funds | [REHEARSED-LOCAL] pass: `initialize_customizable_pool`, fee mode OnlyB, no mint validation rejection, a swap executed | tx `488TL3k2v9sk...mvEC` |
| (b) / DM-2 | Permanent LP lock | [UNVERIFIED] | [REHEARSED-LOCAL] pass: `permanent_lock_position` ran in the same tx as pool creation (SDK `isLockLiquidity`), position `permanentLockedLiquidity` = full liquidity | same tx |
| (b) | Fee claim from the locked position | [UNVERIFIED] | [REHEARSED-LOCAL] pass: keypair owner claimed 119,999 raw USDC after one 1 USDC swap | tx `4DSFkDESk5mZ...` |
| (c) / DM-3 | Position owned by a Squads vault PDA claims fees | [UNVERIFIED] | [REHEARSED-LOCAL] pass: the `kruxa-venue` plan was executed as a Squads v4 vault transaction (vault is creator, payer and NFT owner; NFT mint is a Squads ephemeral signer). The vault then claimed 119,999 raw USDC through a second vault transaction. The owner does NOT have to be a keypair | create `5nTu9xugbV3K...`, claim `3cjkwB2nXApY...` |
| (c) custom program PDA | Position owned by Kruxa's own program PDA | [UNVERIFIED] | [UNVERIFIED] not run. Mechanism is the same (PDA signs by `invoke_signed`; `claim_position_fee` needs `signer`), but no Kruxa program was deployed in the spike | none |
| (c) delegate | Delegate keypair with `ClaimPositionFeeToOwner` | [UNVERIFIED] | [UNVERIFIED] not run (permission enum exists in SDK) | none |
| (d) | 50/15/15/10/10 split | [UNVERIFIED] | [REHEARSED-LOCAL] two-owner path works: `split_position2` moved 50% of a permanently locked position to a second owner; the second position keeps its locked liquidity and the second owner claimed 4,000 of 8,000 raw (50%). See "Split design" | split `2jYfC5KfvWNQ...` |
| (e) | Decaying base-fee scheduler | [UNVERIFIED] | [REHEARSED-LOCAL] pass: linear 1500 to 100 bps over 6 periods in 60 s. A 1 USDC buy at t0 paid 150,000 raw total fee (LP share 119,999 after the 20% protocol cut); the same buy after 60 s paid 10,000 (LP share 8,000). Ratio 15.0 = 1500/100 | swaps/claims `4DSFkDESk5mZ...`, `5PTxiJHqs1Wo...`, `37yevty6qmp3...`, `4g6LaPtC7Zpp...` |
| (f) | Pool creation cost | [UNVERIFIED] | [REHEARSED-LOCAL] 0.022616 SOL for the whole creation tx (tx fee, pool, position, two vaults, NFT; ATAs excluded). Vault-run creation: 0.022606 SOL. Matches the ~0.022 SOL secondary estimate. Rent is cluster independent, so devnet should match; confirm on devnet | `488TL3k2...` |
| DM-4 | Protocol fee share | [UNVERIFIED] | [REHEARSED-LOCAL] `poolFees.protocolFeePercent` = 20, fixed by the program | pool state read |
| (g) | DexScreener / GeckoTerminal / Jupiter indexing | [UNVERIFIED] | [UNVERIFIED] | see below |
| S-4 | Squads timelock | [UNVERIFIED] | [REHEARSED-LOCAL] with a 20 s timelock an early `vault_transaction_execute` was rejected (`TimeLockNotReleased`) and succeeded after the delay | multisig `5U8qhJggsimB...` |

(g) from docs only: nothing in the research notes confirms indexing. Jupiter states it routes through nearly all major Solana AMMs and auto-lists new markets on certain DEXes (which ones is not named); unverified tokens trade with warnings; new pools get 14 days of instant routing per the notes. DexScreener and GeckoTerminal indexing of DAMM v2 is assumed from its size (DefiLlama about $23M TVL) but not confirmed by a primary source. Devnet is not indexed. Test with a tiny mainnet pool (DC-Q) and use switch trigger 3.

## Findings that change the design
1. **No grinding needed.** Pool PDA seeds are order independent, so the quote mint can be token B whatever the addresses are. Fee mode OnlyB then collects USDC.
2. **Lock needs the owner's signature in the creation tx.** For a vault the whole plan must run as one vault transaction. Confirmed with an ephemeral signer for the NFT mint.
3. **Vault tx compute:** the Squads execute transaction needs a raised compute limit (we set 1,400,000 units); the default 200,000 failed.
4. **Fee scheduler runs from activation, in time periods.** A launch must set `--activation-ts` so the high-fee window starts when trading opens. Rate limiter is deprecated and refused by the SDK.
5. **Protocol takes 20% first.** Net fee to Kruxa positions is 80% of the swap fee. The PRD 50/15/15/10/10 split applies to what remains after that; recompute any "1.00% total" claim.
6. **Fees are in token B only** (OnlyB), so claimed fees are USDC and no base token is dumped.

## Split design (for 50/15/15/10/10)
Two shapes work mechanically:
- A. Position split: `split_position2` to N owners with different numerators (rehearsed with 2). Each owner claims on its own. Needs both owners to sign the split, so do it at launch, before ownership moves to the vault. A Squads vault cannot co-sign with a keypair inside one vault transaction.
- B. One vault-owned position plus a Kruxa payout leg from claimed USDC (recommended by ARCHITECTURE 5.10: one position, one claimer). Needs custody logic on the Kruxa side.
The holders (15%) and referral (10%) slices have no Solana-side primitive: they must be paid by Kruxa code from claimed USDC in either shape. [UNVERIFIED design choice, Dami to rule.]

## To finish on devnet
1. Fund `8K2kQuuavjCo7QTREyKMUDJfpAHVyV6PqJooW56nDBCA` at faucet.solana.com. Minimum 0.3 SOL, recommended 1 SOL.
2. `cd services/venue && VAULT_FUND_SOL=0.06 npx tsx ../../spikes/meteora/src/spike.ts devnet` (about 4 minutes, resumable via `state.devnet.json`).
3. Copy the devnet rows from `results.devnet.json` into this table and flip the Devnet column to [VERIFIED-DEVNET] with signatures.
4. Not covered by the script: custom-program PDA claim, delegate claim, DBC-1 to DBC-4 (S-3), Raydium CPMM and Orca lock notes (see DECISION-fallback-raydium-cpmm.md).

## Devnet run 2026-11-08 (VERIFIED on Solana devnet, real DAMM v2 and Squads v4 programs)

Run by the coordinator from `services/venue` with `VAULT_FUND_SOL=0.06 npx tsx ../../spikes/meteora/src/spike.ts devnet`. Funded with 1 devnet SOL (faucet SOL forwarded from the genesis relayer devnet key; tx 4VsHyxy7JMeDPsZ5fr7a8CSret8LM2j5nLx2iqMwR3er6YkZRGPVae6qoLgheJJHSAU8FqhNqW4Hywwv75kf7BGB). Signatures below are devnet signatures and can be looked up on a devnet explorer. Total spend 0.130111 SOL (play money). The `ws error 429` line is a websocket subscription rate limit and did not affect results.

```
net=devnet payer=8K2kQuuavjCo7QTREyKMUDJfpAHVyV6PqJooW56nDBCA balance=1.000000 SOL
PASS a-create-pool-external-mint 4D7mHkjehMqA5iqydJMnTyQ2v1JygSVAfxaWR1zdDPJRXHuaiMxap9ArwHuW8PmVwsDSPKbTdsRWXzQDgvsCqNbi plain SPL base 4Ne1ZQhC21XJZBRpsv5wHqyVn5pRK7ayMMkDMEVoX2SX (mint+freeze auth null), test USDC; collectFeeMode=1
PASS b-permanent-lock 4D7mHkjehMqA5iqydJMnTyQ2v1JygSVAfxaWR1zdDPJRXHuaiMxap9ArwHuW8PmVwsDSPKbTdsRWXzQDgvsCqNbi permanentLockedLiquidity=583337269021023124047623965365 in same tx as create
PASS dm4-protocol-fee 4D7mHkjehMqA5iqydJMnTyQ2v1JygSVAfxaWR1zdDPJRXHuaiMxap9ArwHuW8PmVwsDSPKbTdsRWXzQDgvsCqNbi pool.poolFees.protocolFeePercent=20 (read from created pool; fixed by program, not set by creator)
PASS f-cost-pool1 4D7mHkjehMqA5iqydJMnTyQ2v1JygSVAfxaWR1zdDPJRXHuaiMxap9ArwHuW8PmVwsDSPKbTdsRWXzQDgvsCqNbi payer balance delta 0.016510 SOL (tx fee, pool, position, vaults, NFT rent; ATAs pre-existed)
PASS b-fee-claim-locked-position 2pihB5maYmXsuWPECY1BUpTWpH9SR1YRSLDhMoNMBLmXopAeqbxRrzz72c6ahYywLeGmwJbDGE6gyj3gLAprWezv,5MoX6Sa5YaXkwSAtR7sFQXCEQ5RS6rZkj43siZqsFTHuQxDZP1pnNofCDYLsAbhcWA6j755V8fBnzUaiNntJ4VT6 keypair owner claimed 119999 raw quote after 1 swap on a permanently locked position
PASS e-fee-scheduler 2pihB5maYmXsuWPECY1BUpTWpH9SR1YRSLDhMoNMBLmXopAeqbxRrzz72c6ahYywLeGmwJbDGE6gyj3gLAprWezv,5MoX6Sa5YaXkwSAtR7sFQXCEQ5RS6rZkj43siZqsFTHuQxDZP1pnNofCDYLsAbhcWA6j755V8fBnzUaiNntJ4VT6,ghXqvJb8JvEVDtGSWb8QdKnuszqr9ncNr6icTj8oepKKonQJ9NTvHyTQ4g11rgygyCky23P9gE6dPvmZtjjkWjT,4ku4F4iTAb1UXnc5cjcy9AtE8rrJvvqwQLWGUrjRCeE9bZ8iuqxxdjQSRqNyfJANEMhM7XZ7Cd4s5ztachHwcTcN 1 USDC swap at t0 yielded 119999 LP fee, same swap after 60s yielded 8000; ratio 15.0 (schedule 1500 to 100 bps over 6 periods, linear)
PASS d-two-owner-split 3PcfAdeZbtJRHLApT7nChaxcCm1PmfdeTYhfjKRSJayEVvkepEYKgDF2Ws4DhEz15vkK83D3Pvvsrm9mLcR2q6Vm,5s6MizLMwSWZPDP18vv4HWsGh2XgbLsbS46xkYjMen6T5BY9LphfRxFte17bkm23mv5RobDVXvmzHqf7Ta9UyEaJ,2uMFji8X41DRVB1WTQG1c12sv3uG21PvfjaZd8F8K3fajjYwZiqk5A35D2EXNvkKNVrCGdqo8f4eV6aYvuCjqBzr split_position2 numerator 50% of a permanently LOCKED position to a second owner EY83tmmVJmxH18ganTTzKVFwPAMy8oC6vH9vsqa5iSaL: second position lockedLiquidity=291668634510511562023811982682; second owner claim gained 4000
PASS c0-squads-multisig 26cxoWLLicAtsFPECTKG25p1VbzbLwxN2gmYuYZjrDatMVRJ1zcoEFBvoqppwUunP6J5JVP7kkFApPzkxtb8zgCw 1-of-1 multisig AbTuhsXjhacUYrksgymKrFwA231rL6p8uuubF67mRpG8 timeLock 20s, vault 8at6bgUimHqikuAhTVv55UGW5oRymPU5auf1EXzgMVmt
PASS c-vault-creates-and-locks 2ok2uXZtsiH3pn12eKRXDgXAFDeD1KLmR74WxBE8d7vdJERaFgtMKSUN6Ntkw1UvB2uwZdCNtdxWWj4pr9PdFdnJ,3ypREpZcfKkpTFTrPHMnKyjjw17eVMNhzRQGUxBoMTLfYfuQs1edcgUB6DgZqX5FKkK2stBHaDhnSR5BeCYd74kK,39MJpCLU7VRvnPtwT3HEXBPUoquomkKALEPTSUiojh4nSV4TJatZvBLf6TMR6nPRUTLggTmAhPdSPcG75G1sZDLg kruxa-venue plan executed as Squads vault tx (ephemeral signer for NFT); NFT owner=8at6bgUimHqikuAhTVv55UGW5oRymPU5auf1EXzgMVmt (vault); locked=583337269021023124047623965365; early execute: rejected (TimeLockNotReleased); pool cost from vault 0.016500 SOL
PASS c-vault-claims-fees 3KJ2SEDwyY2uuMPPgwevHp1E42o6EZAKLZVbQFFzNXTYPDmbWYkMrKrZMwLNF3sGy28VWFp1bCHdMgb2bmDxqAZU,5tT8Es8nnDyuPwGnhWff9JM4e3z9dhwybb4fUE6yXXMkZR3igEABjNNzke6HgqhffL23qf1wDCoVtTizo9QuaevF,2zergtWNE9Y2XXcLu3GfEZGNuFdcewRccPsugJpL29crgxbUyTx8ce8op1VCj5ozAYmfvR3Wdy8BFSHMpeGUphdY,4Ld1XytjxmTmxzu2qQfF3nA3P3G4gfuKc3FxzmGqEUXFj6hMphsb2vucaC3XPyzKrFYFfibF5Zeqry72T31Aj59E Squads-vault-owned permanently locked position claimed 119999 raw quote to the vault ATA via a vault transaction
spent 0.130111 SOL total
```

Not run in this pass: position owned by a PDA of Kruxa's own program; delegate keypair claiming on the owner's behalf; DBC checks; DexScreener, GeckoTerminal and Jupiter indexing (not testable on devnet).

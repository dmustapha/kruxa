# S-1 notes: sources and versions (read 2026-11-08)

| Item | Value | Source |
|---|---|---|
| DAMM v2 program | cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG, executable on devnet [VERIFIED by `solana program show`: upgradeable, authority DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX, 1559448 bytes] | own RPC read |
| IDL version in SDK | 0.2.5 (changelog upstream lists 0.2.6) | `CpAmmIdl.metadata.version` |
| SDK | @meteora-ag/cp-amm-sdk 1.5.1 (npm, modified 2026-10-23) | npm registry |
| Pinned peers | @solana/web3.js 1.98.4 (3.x exists but the SDK wants ^1.95), @coral-xyz/anchor 0.31.1, @solana/spl-token 0.4.15, bn.js 5.2.5, @sqds/multisig 2.1.4 | package.json (exact) |
| Squads v4 | SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf; devnet program config multisigCreationFee 0 lamports | own RPC read |
| Spec inputs | meteora_fallback.md, trading_venues_fee_routing.md, PLAN C3.3 to C3.6, ARCHITECTURE 5.10, PRD C5 and 4b.3 | local docs |

SDK facts read from `dist/index.mjs` [VERIFIED by reading]:
- `createCustomPool` with `isLockLiquidity: true` appends `permanent_lock_position(liquidityDelta)` to the same transaction, signed by `creator`.
- `initialize_customizable_pool`: `creator` is NOT a signer (it only receives the NFT); `position_nft_mint` and `payer` sign. So a vault can be creator and payer, and the NFT mint can be a Squads ephemeral signer.
- `claim_position_fee`, `permanent_lock_position`: `signer` must be the NFT account owner or a delegate with permission.
- Pool PDA seeds are order-independent (the SDK sorts them), so token A/B can be assigned freely. We pass quote as token B so fee mode OnlyB collects quote.
- RateLimiter base-fee mode throws `DeprecatedBaseFeeModeError` for new pools. Only time and market-cap schedulers remain.
- PositionDelegatePermission has ClaimPositionFee and ClaimPositionFeeToOwner: an alternative claim path (delegate keypair claims into the owner's accounts) [UNVERIFIED by run].

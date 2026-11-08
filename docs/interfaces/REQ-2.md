# REQ-2: F0 policy-gated sign request (from A2 to A1, Task 4.6, `contracts/core/src/f0.rs`)

* Testnet signer: `v1.signer-prod.testnet`, domain 1 = Ed25519, root key `ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2`
  [VERIFIED by `public_key {"domain_id":1}`, `version` 3.18.0, read-only, 2026-11-08]. The mainnet account is `v1.signer` (signed-test kit).
* Derivation: child key for predecessor `core.<root>` and path `kruxa:genesis:<launch_id>`. Offline derivation (`tools/genesis/f0_derive.py`,
  `relayer/src/derive.ts`) equals the signer's `derived_public_key` view byte for byte [VERIFIED live]. The view takes `predecessor`, not `predecessor_id`.
* Contract: store `tx1_hash = sha256(tx1_message)` and `tx2_hash = sha256(tx2_message)` where the messages are
  `compile(spec, blockhash, price)` (the keeper passes blockhash and price; the contract recomputes or stores the hashes the keeper commits
  after `commit_genesis`). `sign_genesis(launch_id, tx_index)` calls
  `v1.signer-prod.testnet.sign({"request":{"payload_v2":{"Eddsa":"<hex message>"},"path":"kruxa:genesis:<id>","domain_id":1}})`,
  attached deposit 1 yoctoNEAR, 300 Tgas, ONLY if `sha256(message) == stored hash`, else `E_POLICY_MISMATCH`.
  The callback stores the 64-byte signature. The signature response shape is `{signature:[64 bytes]}` or `{Ed25519:{signature}}`; the relayer accepts both [UNVERIFIED until a live testnet sign].
* The message to be signed is passed in the call (the contract does not need to embed the compiler); the relayer verifies the signature offline
  against the derived key before broadcasting (`F0Signer.sign`).
* Latency budget: mainnet p50 13.5 s, p95 15.1 s per signature (signed test T2); two signatures per ceremony, so `start_ts >= commit + 150 s`.

# Honesty Ledger

Every disclosure Kruxa makes, with the document or test that proves it.

1. No independent audit has covered this code. Proof: `SECURITY.md` "Not defended against" item 5; `docs/INVARIANTS.md`.
2. The Squads reserve vault in the demo is single-party. Proof: `LIMITATIONS.md` (single-party vault); `docs/INVARIANTS.md`.
3. The launch-token factory token is publisher-updatable. Proof: `SECURITY.md` item 4; `LIMITATIONS.md`.
4. The Intents Verifier holds force-withdraw and lock powers over money held in `intents.near`. Proof: `SECURITY.md` item 3.
5. The relay fee is not refunded. Proof: `docs/INVARIANTS.md`.
6. A NEAR-side token exists from the start of a trial. Proof: `docs/INVARIANTS.md`.
7. In phase 0 the upgrade key is held by Dami. Proof: `SECURITY.md` item 2; `docs/INVARIANTS.md`.
8. The sandbox runs protocol 88 and mainnet is recorded as 88 on 2026-11-08; real-network acceptance is untested until the testnet deploy. Proof: `SECURITY.md` item 6; `ARCHITECTURE.md` Section 17.
9. The kruxa_core wasm (456,999 bytes) is over the 350 KB size budget. Proof: `scripts/lint.sh` prints the size against its 600,000 byte gate; `LIMITATIONS.md`.
10. Sybil wallets are not defended against. Proof: `SECURITY.md` item 1.

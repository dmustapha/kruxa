/** The slice of the NEAR core contract the relayer talks to (ARCHITECTURE 5.2 GenesisApi).
 *  MockCore is a SANDBOX stand-in: Task 4.4 (A1) has not merged. It enforces the same refusal rules the contract will. */
export type GenesisRefusal = "R_GENESIS_STATE" | "R_GENESIS_ALREADY" | "R_GENESIS_AUTH";

export interface CoreClient {
  label: string;
  commitGenesis(launchId: bigint, gPub: Uint8Array | null): Promise<void>;
  confirmGenesis(launchId: bigint, mint: string, sigs: string[], slot: number, ceremonyHash: string): Promise<void>;
}

export class GenesisRefused extends Error {
  constructor(readonly code: GenesisRefusal) { super(code); }
}

export class MockCore implements CoreClient {
  label = "SANDBOX MockCore (Task 4.4 not merged)";
  private committed = new Set<string>();
  readonly confirmed = new Map<string, { mint: string; sigs: string[]; slot: number; ceremonyHash: string }>();

  constructor(private readonly verdicts: Record<string, "PASS" | "FAIL">) {}

  async commitGenesis(launchId: bigint): Promise<void> {
    const id = launchId.toString();
    if (this.verdicts[id] !== "PASS") throw new GenesisRefused("R_GENESIS_STATE");
    if (this.committed.has(id)) throw new GenesisRefused("R_GENESIS_ALREADY");
    this.committed.add(id);
  }

  async confirmGenesis(launchId: bigint, mint: string, sigs: string[], slot: number, ceremonyHash: string): Promise<void> {
    const id = launchId.toString();
    if (!this.committed.has(id)) throw new GenesisRefused("R_GENESIS_STATE");
    this.confirmed.set(id, { mint, sigs, slot, ceremonyHash });
  }
}

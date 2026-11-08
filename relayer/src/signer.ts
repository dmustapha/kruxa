import nacl from "tweetnacl";

/** Who signs the two genesis transactions. F1 = memory-only per-launch key; F0 = NEAR Chain Signatures child key. */
export interface GenesisSigner {
  readonly mode: "F1" | "F0";
  pub(): Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
  destroy(): void;
}

export class F1Signer implements GenesisSigner {
  readonly mode = "F1" as const;
  private secret: Uint8Array | null;
  private readonly publicKey: Uint8Array;

  constructor() {
    const kp = nacl.sign.keyPair();
    this.secret = kp.secretKey;
    this.publicKey = kp.publicKey;
  }

  pub(): Uint8Array { return this.publicKey; }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    if (!this.secret) throw new Error("F1 key already destroyed");
    return nacl.sign.detached(message, this.secret);
  }

  destroy(): void {
    this.secret?.fill(0);
    this.secret = null;
  }
}

import type { BlockSource, NearBlock } from "./types.ts";

/** neardata.xyz block source. `/v0/last_block/final` redirects to `/v0/block/{height}`; skipped heights answer `null`. */
export class NeardataSource implements BlockSource {
  readonly name = "neardata";
  readonly network: string;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(network: string, opts: { base?: string; timeoutMs?: number } = {}) {
    this.network = network;
    this.base = opts.base ?? `https://${network}.neardata.xyz`;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async finalHeight(): Promise<number> {
    const b = await this.getJson(`${this.base}/v0/last_block/final`);
    const h = (b as NearBlock | null)?.block?.header?.height;
    if (typeof h !== "number") throw new Error("neardata: last_block/final returned no block");
    return h;
  }

  async block(height: number): Promise<NearBlock | null> {
    const b = await this.getJson(`${this.base}/v0/block/${height}`);
    return b === null ? null : (b as NearBlock);
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`neardata ${res.status} for ${url}`);
    return JSON.parse(await res.text()) as unknown;
  }
}

/** In-memory block source over a prepared list; used by fixtures and tests. */
export class ListSource implements BlockSource {
  readonly name = "fixture";
  readonly network = "fixture";
  private blocks: NearBlock[];
  constructor(blocks: NearBlock[]) {
    this.blocks = blocks;
  }

  replace(blocks: NearBlock[]): void {
    this.blocks = blocks;
  }

  async finalHeight(): Promise<number> {
    return this.blocks[this.blocks.length - 1]?.block.header.height ?? 0;
  }

  async block(height: number): Promise<NearBlock | null> {
    return this.blocks.find((b) => b.block.header.height === height) ?? null;
  }
}

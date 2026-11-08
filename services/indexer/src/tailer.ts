import { ReorgError } from "./store.ts";
import type { Store } from "./store.ts";
import type { BlockSource, Source } from "./types.ts";

export interface TailStatus {
  headHeight: number | null;
  lastError: string | null;
  reorgs: number;
}

/**
 * Walks a BlockSource forward from the store checkpoint. Reorg-safe: each block's `prev_hash` must equal the stored
 * checkpoint hash (neardata skips empty heights, so continuity is by hash, not by height - 1). On a mismatch the tailer
 * rolls back to the newest stored height whose hash the source still agrees with, then continues.
 */
export class Tailer {
  readonly status: TailStatus = { headHeight: null, lastError: null, reorgs: 0 };
  private stopped = false;

  private readonly store: Store;
  private readonly source: BlockSource;
  private readonly sourceTag: Source;
  private readonly startHeight: number | "tip";

  constructor(store: Store, source: BlockSource, sourceTag: Source, startHeight: number | "tip") {
    this.store = store;
    this.source = source;
    this.sourceTag = sourceTag;
    this.startHeight = startHeight;
  }

  stop(): void {
    this.stopped = true;
  }

  /** Catch up to the source's final head. Returns blocks ingested. */
  async catchUp(maxBlocks = Infinity): Promise<number> {
    const head = await this.source.finalHeight();
    this.status.headHeight = head;
    await this.verifyTip();
    let next = await this.nextHeight(head);
    let count = 0;
    while (next <= head && count < maxBlocks && !this.stopped) {
      const nb = await this.source.block(next);
      if (nb) {
        if (!(await this.linked(nb.block.header.prev_hash))) {
          await this.handleReorg(next);
          next = (this.store.checkpoint()?.height ?? next - 1) + 1;
          continue;
        }
        this.ingestOrReorg(nb);
        count++;
      }
      next++;
    }
    return count;
  }

  /** Poll forever; errors are recorded in `status.lastError` and retried after the interval. */
  async run(pollMs: number): Promise<void> {
    while (!this.stopped) {
      try {
        await this.catchUp(500);
        this.status.lastError = null;
      } catch (err) {
        this.status.lastError = (err as Error).message;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  /** The stored tip must still be the source's block at that height; otherwise the chain forked under us. */
  private async verifyTip(): Promise<void> {
    const cp = this.store.checkpoint();
    if (!cp) return;
    const theirs = await this.source.block(cp.height);
    if (theirs && theirs.block.header.hash !== cp.hash) await this.handleReorg(cp.height);
  }

  private async nextHeight(head: number): Promise<number> {
    const cp = this.store.checkpoint();
    if (cp) return cp.height + 1;
    return this.startHeight === "tip" ? head : this.startHeight;
  }

  private async linked(prevHash: string): Promise<boolean> {
    const cp = this.store.checkpoint();
    return cp === null || cp.hash === prevHash;
  }

  private ingestOrReorg(nb: Parameters<Store["ingestBlock"]>[0]): void {
    try {
      this.store.ingestBlock(nb, this.sourceTag);
    } catch (err) {
      if (!(err instanceof ReorgError)) throw err;
      this.store.rollbackTo(err.height - 1);
      this.status.reorgs++;
    }
  }

  /** Walk back through stored hashes until the source still serves a block with that hash. */
  private async handleReorg(at: number): Promise<void> {
    this.status.reorgs++;
    for (let h = at - 1; h > 0; h--) {
      const stored = this.store.blockHash(h);
      if (stored === undefined) continue;
      const theirs = await this.source.block(h);
      if (theirs && theirs.block.header.hash === stored) return this.store.rollbackTo(h);
    }
    this.store.rollbackTo(0);
  }
}

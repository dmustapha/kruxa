import type { LogFn } from "./types.js";

export type Post = (url: string, body: string) => Promise<void>;

export const httpPost: Post = async (url, body) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`webhook answered ${r.status}`);
};

/** One structured JSON log line per alert, plus an optional webhook POST. The same key alerts again only after `repeatMs`;
 *  clear(key) re-arms it so a recurrence is reported at once. */
export class Alerter {
  private readonly last = new Map<string, number>();
  constructor(
    private readonly log: LogFn,
    private readonly o: { webhookUrl?: string; repeatMs: number; now: () => number; post?: Post },
  ) {}

  async raise(key: string, kind: string, detail: Record<string, unknown>): Promise<void> {
    const at = this.o.now();
    const prev = this.last.get(key);
    if (prev !== undefined && at - prev < this.o.repeatMs) return;
    this.last.set(key, at);
    const alert = { kind, key, ...detail };
    this.log("alert", "alert", alert);
    await this.send(alert);
  }

  clear(key: string): void {
    this.last.delete(key);
  }

  private async send(alert: Record<string, unknown>): Promise<void> {
    if (!this.o.webhookUrl) return;
    try {
      await (this.o.post ?? httpPost)(this.o.webhookUrl, JSON.stringify({ service: "kruxa-keeper", at: new Date(this.o.now()).toISOString(), ...alert }));
    } catch (e) {
      this.log("warn", "webhook_failed", { error: String(e instanceof Error ? e.message : e) });
    }
  }
}

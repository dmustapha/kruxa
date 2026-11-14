import { closeSync, openSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Per-launch mutual exclusion. In-process always; across processes when a lock directory is given (exclusive-create file,
 *  taken over once it is older than `staleMs`, so a crash cannot wedge a launch). */
export class LaunchLock {
  private readonly held = new Set<string>();
  constructor(private readonly o: { dir?: string; staleMs: number; now: () => number }) {}

  /** Returns a release function, or null when someone else holds the launch. */
  tryAcquire(id: string): (() => void) | null {
    if (this.held.has(id)) return null;
    const file = this.o.dir ? join(this.o.dir, `launch-${id}.lock`) : undefined;
    if (file && !this.takeFile(file)) return null;
    this.held.add(id);
    return () => {
      this.held.delete(id);
      if (file) try { unlinkSync(file); } catch { /* already gone */ }
    };
  }

  private takeFile(file: string): boolean {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      let age = 0;
      try { age = this.o.now() - statSync(file).mtimeMs; } catch { return this.takeFile(file); }
      if (age <= this.o.staleMs) return false;
      try { unlinkSync(file); } catch { /* raced */ }
      return this.takeFile(file);
    }
  }
}

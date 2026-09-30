/**
 * An in-memory stand-in for the ioredis commands RepoFileCache uses, so tests
 * can assert on what is actually stored rather than on which calls were made.
 * pipeline() and multi() queue commands and report per-command errors from
 * exec() the way ioredis does.
 */
export class FakeValkey {
  strings = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  ttls = new Map<string, number>();

  /** Its own connection, so it can stand in for the shared one. */
  duplicate() {
    return this;
  }

  async flushall() {
    this.strings.clear();
    this.hashes.clear();
    this.ttls.clear();
    return "OK";
  }

  keys(): string[] {
    return [...this.strings.keys(), ...this.hashes.keys()];
  }

  private has(key: string): boolean {
    return this.strings.has(key) || this.hashes.has(key);
  }

  private drop(key: string): number {
    const had = this.has(key);
    this.strings.delete(key);
    this.hashes.delete(key);
    this.ttls.delete(key);
    return had ? 1 : 0;
  }

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }

  async setex(key: string, ttl: number, value: string) {
    this.drop(key);
    this.strings.set(key, value);
    this.ttls.set(key, ttl);
    return "OK";
  }

  async set(key: string, value: string, mode?: string) {
    const ttl = this.ttls.get(key);
    this.drop(key);
    this.strings.set(key, value);
    if (mode === "KEEPTTL" && ttl !== undefined) this.ttls.set(key, ttl);
    return "OK";
  }

  async del(...keys: string[]) {
    return keys.reduce((n, key) => n + this.drop(key), 0);
  }

  async exists(key: string) {
    return this.has(key) ? 1 : 0;
  }

  async hset(key: string, data: Record<string, string>) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(data)) hash.set(field, value);
    this.hashes.set(key, hash);
    return Object.keys(data).length;
  }

  async hgetall(key: string) {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async expire(key: string, ttl: number) {
    if (!this.has(key)) return 0;
    this.ttls.set(key, ttl);
    return 1;
  }

  async rename(from: string, to: string) {
    if (!this.has(from)) throw new Error("ERR no such key");
    const value = this.strings.get(from);
    const hash = this.hashes.get(from);
    const ttl = this.ttls.get(from);
    this.drop(to);
    this.drop(from);
    if (value !== undefined) this.strings.set(to, value);
    if (hash) this.hashes.set(to, hash);
    if (ttl !== undefined) this.ttls.set(to, ttl);
    return "OK";
  }

  pipeline() {
    return this.batch();
  }

  multi() {
    return this.batch();
  }

  private batch() {
    const queued: Array<() => Promise<unknown>> = [];
    const chain: any = new Proxy(
      {},
      {
        get: (_, name: string) => {
          if (name === "exec") {
            return async () => {
              const results: [Error | null, unknown][] = [];
              for (const run of queued) {
                try {
                  results.push([null, await run()]);
                } catch (err) {
                  results.push([err as Error, null]);
                }
              }
              return results;
            };
          }
          return (...args: unknown[]) => {
            queued.push(() => (this as any)[name](...args));
            return chain;
          };
        },
      }
    );
    return chain;
  }
}

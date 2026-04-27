import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Phase 2 E2E support — local node:http stub server (Plan 02-08, Task 8.1).
 *
 * Acts as the receiver for outbound webhook deliveries during the E2E. The
 * dispatch worker POSTs envelopes here over HTTP (gated by the test-only
 * WEBHOOK_OUTBOUND_ALLOW_HTTP=true env var read by createOutboundWebhook,
 * Plan 02-06) and the spec asserts on the captured request bodies.
 */

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  parsedBody: unknown;
  receivedAt: Date;
}

export interface StubServerHandle {
  url: string;
  port: number;
  /** All POSTs received since startup. Cleared by `clear()`. */
  captures: CapturedRequest[];
  /** Wait until `predicate(captures)` is true; returns the matching captures. */
  waitForCapture(
    predicate?: (capt: CapturedRequest[]) => boolean,
    timeoutMs?: number
  ): Promise<CapturedRequest[]>;
  clear(): void;
  close(): Promise<void>;
}

/**
 * Start a local HTTP server that captures every request it receives.
 *
 * Returns 200 OK to every request by default. Tests that want to exercise the
 * retry curve can pass `{ failNTimes: N }` to make the first N requests respond
 * 500.
 */
export async function startStubServer(
  options: { failNTimes?: number } = {}
): Promise<StubServerHandle> {
  let failuresRemaining = options.failNTimes ?? 0;
  const captures: CapturedRequest[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        // keep null — non-JSON bodies are still captured as raw `body`.
      }
      captures.push({
        method: req.method ?? "?",
        url: req.url ?? "/",
        headers: { ...req.headers },
        body,
        parsedBody,
        receivedAt: new Date(),
      });
      if (failuresRemaining > 0) {
        failuresRemaining--;
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("forced failure for retry test");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    captures,
    async waitForCapture(predicate, timeoutMs = 30_000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (predicate ? predicate(captures) : captures.length > 0) {
          return [...captures];
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(
        `Stub server: timed out after ${timeoutMs}ms waiting for capture (had ${captures.length})`
      );
    },
    clear() {
      captures.length = 0;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

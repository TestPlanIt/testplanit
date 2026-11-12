// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LONG_RUNNING_IDLE_TIMEOUT_MS,
  createIdleTimeoutDispatcher,
  fetchLongRunning,
} from "./longRunningFetch";

/**
 * Real requests through the runtime's fetch: a dispatcher from an undici
 * version that fetch cannot drive is rejected before any request is sent, and
 * one whose timeouts are ignored would not cut a silent response off.
 */
describe("fetchLongRunning", () => {
  let server: http.Server;
  let base: string;
  const received: Array<{ method?: string; body: string }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ method: req.method, body });
        if (req.url === "/stall") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write("data: first\n\n");
          return;
        }
        if (req.url === "/silent") {
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: one\n\n");
        setTimeout(() => res.end("data: two\n\n"), 20);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const timing = async (run: () => Promise<unknown>) => {
    const started = Date.now();
    const error = await run().then(
      () => undefined,
      (caught: Error & { cause?: { code?: string } }) => caught
    );
    return { error, elapsed: Date.now() - started };
  };

  it("allows 30 minutes of silence, where the runtime allows 5", () => {
    expect(LONG_RUNNING_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("sends the request and returns the streamed response", async () => {
    received.length = 0;

    const response = await fetchLongRunning(`${base}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("data: one\n\ndata: two\n\n");
    expect(received).toEqual([{ method: "POST", body: '{"prompt":"hello"}' }]);
  });

  it("still stops when the caller's signal aborts", async () => {
    const { error, elapsed } = await timing(async () => {
      const response = await fetchLongRunning(`${base}/stall`, {
        signal: AbortSignal.timeout(200),
      });
      await response.text();
    });

    expect(error?.name).toBe("TimeoutError");
    expect(elapsed).toBeLessThan(2000);
  });

  describe("the dispatcher's idle limits are the ones the runtime applies", () => {
    const stalled = (path: string, idleTimeoutMs: number) =>
      timing(async () => {
        const dispatcher = createIdleTimeoutDispatcher(idleTimeoutMs);
        try {
          const response = await fetch(`${base}${path}`, {
            dispatcher,
          } as RequestInit);
          await response.text();
        } finally {
          dispatcher.close().catch(() => {});
        }
      });

    it("cuts off a response body that goes silent", async () => {
      const { error, elapsed } = await stalled("/stall", 300);

      expect(error?.cause?.code).toBe("UND_ERR_BODY_TIMEOUT");
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(3000);
    });

    it("cuts off a request that never gets response headers", async () => {
      const { error, elapsed } = await stalled("/silent", 300);

      expect(error?.cause?.code).toBe("UND_ERR_HEADERS_TIMEOUT");
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(3000);
    });

    it("lets a body stay silent for longer than a shorter limit would", async () => {
      const { error, elapsed } = await timing(async () => {
        const dispatcher = createIdleTimeoutDispatcher(5000);
        try {
          const response = await fetch(`${base}/stall`, {
            dispatcher,
            signal: AbortSignal.timeout(1200),
          } as RequestInit);
          await response.text();
        } finally {
          dispatcher.close().catch(() => {});
        }
      });

      expect(error?.name).toBe("TimeoutError");
      expect(elapsed).toBeGreaterThanOrEqual(1100);
    });
  });
});

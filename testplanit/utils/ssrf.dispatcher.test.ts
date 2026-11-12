// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPinnedDispatcher } from "./ssrf";

/**
 * Runs a real request through Node's built-in fetch. The repository adapters
 * pass this dispatcher to that fetch, and a dispatcher from an undici version
 * the runtime's fetch cannot drive is rejected before any request is made; a
 * mocked fetch cannot show that.
 */
describe("createPinnedDispatcher with the runtime's fetch", () => {
  let server: http.Server;
  let port: number;
  const hostsSeen: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hostsSeen.push(req.headers.host ?? "");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`served ${req.url}`);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const pinnedFetch = async (url: string) => {
    const dispatcher = createPinnedDispatcher("127.0.0.1");
    const init: RequestInit & { dispatcher?: unknown } = {
      redirect: "manual",
      dispatcher,
    };
    try {
      const response = await fetch(url, init);
      return { status: response.status, body: await response.text() };
    } finally {
      dispatcher.close().catch(() => {});
    }
  };

  it("completes a request through the pinned dispatcher", async () => {
    const result = await pinnedFetch(`http://localhost:${port}/repo/info`);

    expect(result).toEqual({ status: 200, body: "served /repo/info" });
  });

  it("connects to the pinned address whatever the hostname resolves to", async () => {
    hostsSeen.length = 0;

    const result = await pinnedFetch(
      `http://git.unresolvable.invalid:${port}/tree`
    );

    expect(result.status).toBe(200);
    expect(hostsSeen).toEqual([`git.unresolvable.invalid:${port}`]);
  });
});

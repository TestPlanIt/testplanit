/**
 * Integration test for installScreenshotRouteGuard against a real chromium.
 *
 * The critical scenario: the browser network stack follows server-side
 * redirects WITHOUT re-invoking route handlers, so a plain route.continue()
 * guard lets an allowed URL 302-hop to a blocked (internal) host unseen.
 * The guard must validate every hop itself — a blocked host must receive
 * ZERO requests even when reached only via redirect.
 *
 * Skipped automatically when no chromium build is installed (e.g. unit-test
 * CI without playwright browsers).
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { installScreenshotRouteGuard } from "./urlScreenshots";

function installedChromium(): string | null {
  try {
    const path = chromium.executablePath();
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const executablePath = installedChromium();

const GIF = Buffer.from(
  "R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  "base64"
);

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe.skipIf(!executablePath)(
  "installScreenshotRouteGuard (real chromium)",
  () => {
    let browser: Browser;
    let allowedServer: Server;
    let blockedServer: Server;
    let allowedOrigin: string;
    let blockedOrigin: string;
    const blockedHits: string[] = [];
    const allowedHits: string[] = [];

    beforeAll(async () => {
      // Stands in for an internal host: the injected isAllowed denies its
      // origin, so no request may ever reach it — not even via redirect.
      blockedServer = createServer((req, res) => {
        blockedHits.push(req.url ?? "");
        res.writeHead(200, { "content-type": "image/gif" });
        res.end(GIF);
      });
      blockedOrigin = await listen(blockedServer);

      allowedServer = createServer((req, res) => {
        allowedHits.push(req.url ?? "");
        switch (req.url) {
          case "/page":
            res.writeHead(200, { "content-type": "text/html" });
            res.end(
              `<html><body>
                <img src="${allowedOrigin}/hop-to-blocked">
                <img src="${blockedOrigin}/direct.gif">
                <img src="${allowedOrigin}/hop-to-allowed">
                <img src="${allowedOrigin}/ok.gif">
              </body></html>`
            );
            return;
          case "/hop-to-blocked":
            res.writeHead(302, { location: `${blockedOrigin}/secret.gif` });
            res.end();
            return;
          case "/hop-to-allowed":
            res.writeHead(302, { location: "/hopped.gif" });
            res.end();
            return;
          default:
            res.writeHead(200, { "content-type": "image/gif" });
            res.end(GIF);
        }
      });
      allowedOrigin = await listen(allowedServer);

      browser = await chromium.launch({ executablePath: executablePath! });
    }, 60_000);

    afterAll(async () => {
      await browser?.close().catch(() => {});
      allowedServer?.close();
      blockedServer?.close();
    });

    it(
      "validates every redirect hop — a blocked host is never contacted",
      { timeout: 60_000 },
      async () => {
        const context = await browser.newContext();
        try {
          await installScreenshotRouteGuard(
            context,
            async (url) => url.startsWith(allowedOrigin)
          );
          const page = await context.newPage();
          await page.goto(`${allowedOrigin}/page`, {
            waitUntil: "networkidle",
            timeout: 30_000,
          });

          // Direct blocked request and redirect-to-blocked both stopped.
          expect(blockedHits).toEqual([]);
          // Allowed traffic still flows, including an allowed redirect hop.
          expect(allowedHits).toContain("/ok.gif");
          expect(allowedHits).toContain("/hop-to-allowed");
          expect(allowedHits).toContain("/hopped.gif");
        } finally {
          await context.close().catch(() => {});
        }
      }
    );
  }
);

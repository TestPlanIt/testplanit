import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

import { expect, test } from "../../fixtures/index";
import {
  seedInboundConfig,
  type InboundAdapter,
} from "../../fixtures/webhooks-seed";

/**
 * Inbound body-cap boundary (I-05).
 *
 * The receiver caps inbound body length at 5 MiB exactly (5_242_880 bytes,
 * `MAX_WEBHOOK_BYTES` in `app/api/webhooks/[token]/route.ts`). The gate
 * fires BEFORE signature / Basic-Auth verification — a 413 must come back
 * for over-cap requests regardless of whether the signature would have
 * verified, and the gate must NOT write a delivery row.
 *
 * This spec exercises the boundary at three points per adapter:
 *   1. EXACTLY at-cap (5_242_880 bytes) with a VALID signature → 200 +
 *      possibly a `no-link` / `no_handler` delivery row (depends on
 *      adapter; the cap test doesn't care which 200-outcome it lands on,
 *      only that the cap didn't reject).
 *   2. EXACTLY at-cap with an INVALID signature → 401 (cap allowed, auth
 *      failed). Proves the cap doesn't count "near-cap" as oversize.
 *   3. EXACTLY 1 byte over cap (5_242_881) — independent of signature
 *      validity → 413. Proves the cap fires BEFORE signature verification.
 *
 * Padding strategy: each adapter has a tiny "lift" set of fields the
 * receiver actually reads (issue.key + status.name for Jira; etc.). Around
 * those we inject a `padding` field with a string of computed length so
 * the JSON-stringified body lands at the EXACT byte target. The padding
 * is JSON-string-safe (no quotes / backslashes in the padding chars) so
 * `JSON.stringify` doesn't change the length.
 */

const CAP = 5_242_880;

/**
 * Build a JSON body for the given adapter that lands at EXACTLY `targetBytes`
 * stringified. Returns the JSON string (NOT the parsed object).
 *
 * The build is two-pass: first construct a "skeleton" with a placeholder
 * padding field, then compute the delta between current length and the
 * target, then emit a final string with a padding of the right size. The
 * padding only contains ASCII chars `a` so it survives JSON-encoding without
 * length-altering escapes.
 */
function buildPaddedBody(adapter: InboundAdapter, targetBytes: number): string {
  const buildSkeleton = (paddingLen: number): string => {
    const padding = "a".repeat(paddingLen);
    if (adapter === "JIRA") {
      return JSON.stringify({
        webhookEvent: "jira:issue_updated",
        issue: {
          key: "CAP-J-1",
          fields: { status: { name: "In Progress" } },
        },
        padding,
      });
    }
    if (adapter === "GITHUB") {
      return JSON.stringify({
        action: "closed",
        issue: {
          number: 1,
          state: "closed",
          title: "I-05 cap",
        },
        repository: { full_name: "octocat/I05-Cap" },
        padding,
      });
    }
    // AZURE_DEVOPS
    return JSON.stringify({
      eventType: "workitem.updated",
      resource: {
        id: 297,
        fields: { "System.State": "Closed" },
      },
      padding,
    });
  };

  // Iterate to converge on the exact target — JSON.stringify length is
  // deterministic given the inputs, but the padding length needed is the
  // delta between target and the skeleton-without-padding. Two passes
  // suffice: first to learn the skeleton overhead, second to emit final.
  const overhead = buildSkeleton(0).length;
  const padLen = targetBytes - overhead;
  if (padLen < 0) {
    throw new Error(
      `buildPaddedBody: targetBytes ${targetBytes} smaller than skeleton overhead ${overhead}`
    );
  }
  const final = buildSkeleton(padLen);
  if (final.length !== targetBytes) {
    throw new Error(
      `buildPaddedBody: failed to converge — got ${final.length}, want ${targetBytes}`
    );
  }
  return final;
}

function signGitHubOrJira(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function basicAuth(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
}

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Inbound body-cap boundary at 5 MiB exactly (I-05)", () => {
  let projectId: number;
  let prisma: PrismaClient;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Cap Boundary ${uniqueId}`);
    prisma = new PrismaClient();
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  for (const adapter of ["JIRA", "GITHUB", "AZURE_DEVOPS"] as const) {
    test(`${adapter}: 5 MiB exactly with VALID signature → 200; 5 MiB with INVALID → 401; 5 MiB + 1 byte → 413 (no delivery row)`, async ({
      request,
      baseURL,
    }) => {
      const seeded = await seedInboundConfig(prisma, {
        projectId,
        adapterType: adapter,
        credentialInput:
          adapter === "AZURE_DEVOPS"
            ? {
                kind: "AZURE_DEVOPS",
                username: "tpi",
                password: "i05-cap",
              }
            : undefined,
      });

      const headersForBody = (
        body: string,
        valid: boolean
      ): Record<string, string> => {
        if (adapter === "AZURE_DEVOPS") {
          return {
            "content-type": "application/json",
            authorization: valid
              ? basicAuth("tpi", "i05-cap")
              : basicAuth("tpi", "wrong"),
          };
        }
        const sig = valid
          ? signGitHubOrJira(body, seeded.secret)
          : "sha256=" + "0".repeat(64);
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-hub-signature-256": sig,
        };
        if (adapter === "GITHUB") headers["x-github-event"] = "issues";
        return headers;
      };

      // 1. EXACTLY at-cap with valid signature → 200.
      const atCapValid = buildPaddedBody(adapter, CAP);
      expect(atCapValid.length).toBe(CAP);
      const atCapValidResponse = await request.post(
        `${baseURL}/api/webhooks/${seeded.token}`,
        {
          data: atCapValid,
          headers: headersForBody(atCapValid, true),
          timeout: 30_000,
        }
      );
      expect(atCapValidResponse.status()).toBe(200);

      // 2. EXACTLY at-cap with invalid signature → 401 (cap allowed, auth
      //    failed). Proves the cap is at LEAST 5 MiB inclusive.
      const atCapInvalid = buildPaddedBody(adapter, CAP);
      // Vary one padding byte so the body differs from atCapValid (no
      // dedup collision) without changing the byte count.
      const atCapInvalidVaried = atCapInvalid.replace(/a"/, 'b"');
      expect(atCapInvalidVaried.length).toBe(CAP);
      const atCapInvalidResponse = await request.post(
        `${baseURL}/api/webhooks/${seeded.token}`,
        {
          data: atCapInvalidVaried,
          headers: headersForBody(atCapInvalidVaried, false),
          timeout: 30_000,
        }
      );
      expect(atCapInvalidResponse.status()).toBe(401);

      // 3. EXACTLY 1 byte over cap → 413, INDEPENDENT of signature validity.
      //    Send with a valid-looking-but-still-rejected signature; the cap
      //    fires first and short-circuits the whole verification step.
      const overCap = buildPaddedBody(adapter, CAP + 1);
      expect(overCap.length).toBe(CAP + 1);
      const overCapResponse = await request.post(
        `${baseURL}/api/webhooks/${seeded.token}`,
        {
          data: overCap,
          headers: headersForBody(overCap, true),
          timeout: 30_000,
        }
      );
      expect(overCapResponse.status()).toBe(413);

      // No delivery row written for the OVER-cap request. The at-cap-VALID
      // request will have written one row (200 outcome), the at-cap-INVALID
      // and over-cap requests must not.
      const failedRows = await prisma.webhookDelivery.findMany({
        where: {
          webhookConfigId: seeded.configId,
          OR: [
            { error: "signature-mismatch" },
            { error: "auth-mismatch" },
            { error: { startsWith: "413" } },
          ],
        },
      });
      expect(failedRows).toHaveLength(0);
    });
  }
});

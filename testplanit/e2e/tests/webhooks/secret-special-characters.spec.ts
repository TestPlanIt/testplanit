import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

import { expect, test } from "../../fixtures/index";
import {
  seedInboundConfig,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";
import { decrypt } from "../../../utils/encryption";

/**
 * Secret round-trip with special characters (L-01).
 *
 * Verifies that the encryption helper + each adapter's `verify()` path round-
 * trip arbitrary UTF-8 cleanly. The test inputs deliberately include: a
 * newline, a literal double-quote, an angle bracket, a backslash, and an
 * emoji — characters that have historically broken naive JSON / Basic-Auth /
 * URL handling.
 *
 * Coverage matrix:
 *   - JIRA inbound HMAC secret (sha256 over rawBody)
 *   - GitHub inbound HMAC secret (sha256= over rawBody)
 *   - Azure DevOps inbound Basic-Auth password (D-09 — the action JSON-encodes
 *     `{ username, password }` BEFORE encryption; the receiver `JSON.parse`s
 *     after decrypt and `timingSafeEqual`s each half)
 *   - Outbound GENERIC_HMAC signing secret (sha256 over outbound envelope)
 *
 * The outbound case asserts the round-trip via direct decrypt() of the stored
 * `WebhookConfigSecret.secret` column rather than firing a request through
 * the dispatch worker — the contract under test is "the encryption helper
 * preserves UTF-8", and the worker round-trip would add unrelated assertions.
 */

const SPECIAL = `line1\nline2"quoted"<angle>\\backslash🔑emoji`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook secret with special characters round-trips end-to-end (L-01)", () => {
  let projectId: number;
  let prisma: PrismaClient;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Secret Special ${uniqueId}`);
    prisma = new PrismaClient();
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("JIRA inbound HMAC secret with newline + quote + emoji verifies a signed request", async ({
    request,
    baseURL,
  }) => {
    const seeded = await seedInboundConfig(prisma, {
      projectId,
      adapterType: "JIRA",
      credentialInput: { kind: "HMAC_SECRET", secret: SPECIAL },
    });

    const body = JSON.stringify({
      webhookEvent: "jira:issue_updated",
      issue: {
        key: "L01-JIRA-1",
        fields: { status: { name: "In Progress" } },
      },
    });
    const sig =
      "sha256=" + createHmac("sha256", SPECIAL).update(body).digest("hex");

    const response = await request.post(
      `${baseURL}/api/webhooks/${seeded.token}`,
      {
        data: body,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sig,
        },
      }
    );
    expect(response.status()).toBe(200);

    // Defense — the wrong secret must FAIL with 401 (proves the receiver is
    // actually verifying against the round-tripped secret, not skipping).
    const wrongSig =
      "sha256=" +
      createHmac("sha256", SPECIAL + "x")
        .update(body)
        .digest("hex");
    const wrongResponse = await request.post(
      `${baseURL}/api/webhooks/${seeded.token}`,
      {
        data: body,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": wrongSig,
        },
      }
    );
    expect(wrongResponse.status()).toBe(401);
  });

  test("GitHub inbound HMAC secret with newline + quote + emoji verifies a signed request", async ({
    request,
    baseURL,
  }) => {
    const seeded = await seedInboundConfig(prisma, {
      projectId,
      adapterType: "GITHUB",
      credentialInput: { kind: "HMAC_SECRET", secret: SPECIAL },
    });

    const body = JSON.stringify({
      action: "closed",
      issue: { number: 1, state: "closed", title: "L01 GitHub" },
      repository: { full_name: "octocat/L01-Special" },
    });
    const sig =
      "sha256=" + createHmac("sha256", SPECIAL).update(body).digest("hex");

    const response = await request.post(
      `${baseURL}/api/webhooks/${seeded.token}`,
      {
        data: body,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sig,
          "x-github-event": "issues",
        },
      }
    );
    expect(response.status()).toBe(200);
  });

  test("Azure DevOps inbound Basic Auth password with newline + quote + emoji verifies a signed request", async ({
    request,
    baseURL,
  }) => {
    // ADO secret column stores JSON.stringify({username, password}) per D-09.
    // The password half exercises the same special-char surface as the HMAC
    // secrets above; username is plain ASCII to isolate the round-trip
    // contract to one moving part.
    const adoUser = "tpi";
    const adoPass = SPECIAL;
    const seeded = await seedInboundConfig(prisma, {
      projectId,
      adapterType: "AZURE_DEVOPS",
      credentialInput: {
        kind: "AZURE_DEVOPS",
        username: adoUser,
        password: adoPass,
      },
    });

    const basic =
      "Basic " +
      Buffer.from(`${adoUser}:${adoPass}`, "utf8").toString("base64");
    const body = JSON.stringify({
      eventType: "workitem.updated",
      resource: { id: 297, fields: { "System.State": "Active" } },
    });

    const response = await request.post(
      `${baseURL}/api/webhooks/${seeded.token}`,
      {
        data: body,
        headers: {
          "content-type": "application/json",
          authorization: basic,
        },
      }
    );
    expect(response.status()).toBe(200);

    // Defense — wrong password byte must 401.
    const wrongBasic =
      "Basic " +
      Buffer.from(`${adoUser}:${adoPass}x`, "utf8").toString("base64");
    const wrongResponse = await request.post(
      `${baseURL}/api/webhooks/${seeded.token}`,
      {
        data: body,
        headers: {
          "content-type": "application/json",
          authorization: wrongBasic,
        },
      }
    );
    expect(wrongResponse.status()).toBe(401);
  });

  test("Outbound GENERIC_HMAC signing secret with special characters round-trips through encrypt/decrypt", async () => {
    const seeded = await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/L01/special-chars",
      secret: SPECIAL,
    });

    // Read the encrypted secret from disk; verify it decrypts back to the
    // exact bytes the caller supplied. This is the contract every dispatch
    // signing path depends on (the dispatcher reads WebhookConfigSecret.secret
    // and hands the plaintext to crypto.createHmac). Confirming the helper
    // round-trips here lets the L-01 test stand without simulating a full
    // outbound dispatch (the dispatch path is covered by replay-single-outbound
    // / outbound-slack-test-run / replay-bulk-deliveries already).
    const stored = await prisma.webhookConfigSecret.findFirst({
      where: { webhookConfigId: seeded.configId, retiredAt: null },
      select: { secret: true },
    });
    expect(stored).not.toBeNull();
    const decrypted = await decrypt(stored!.secret);
    expect(decrypted).toBe(SPECIAL);

    // The legacy WebhookConfig.secret column is kept lockstep per the
    // production action's invariant (Phase 1 reads still hit it directly).
    const config = await prisma.webhookConfig.findUnique({
      where: { id: seeded.configId },
      select: { secret: true, adapterType: true },
    });
    expect(config?.adapterType).toBe("GENERIC_HMAC");
    expect(config?.secret).not.toBeNull();
    const decryptedLegacy = await decrypt(config!.secret);
    expect(decryptedLegacy).toBe(SPECIAL);
  });
});

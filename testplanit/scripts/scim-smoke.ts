#!/usr/bin/env tsx
/**
 * scim-smoke.ts — Single-command SCIM endpoint exerciser.
 *
 * Mints a short-lived SCIM bearer token (direct DB call via the same
 * mintScimToken helper the admin UI uses), then runs the full SCIM 2.0
 * endpoint surface against a local server (default http://localhost:3000):
 *
 *   1.  GET    /api/scim/v2/ServiceProviderConfig
 *   2.  POST   /api/scim/v2/Users           (create test User)
 *   3.  GET    /api/scim/v2/Users           (list)
 *   4.  GET    /api/scim/v2/Users/{id}      (read)
 *   5.  PATCH  /api/scim/v2/Users/{id}      (active=false)
 *   6.  POST   /api/scim/v2/Groups          (create test Group with one member)
 *   7.  GET    /api/scim/v2/Groups          (list)
 *   8.  GET    /api/scim/v2/Groups/{id}     (read; assert members include test User)
 *   9.  PATCH  /api/scim/v2/Groups/{id}     (add-member op — re-adds test User)
 *   10. DELETE /api/scim/v2/Groups/{id}     (tombstone)
 *   11. DELETE /api/scim/v2/Users/{id}      (tombstone)
 *   12. revokeScimToken                 (token cleanup — always runs)
 *
 * Each step prints `PASS (Xms)` or `FAIL (Xms) (<reason>)`. Exit 0 when
 * every step passes, exit 1 on any failure. Target end-to-end runtime is
 * under 10 seconds against a warm local dev server.
 *
 * Prerequisites:
 *   - `pnpm dev` (or the production build) running in a separate shell
 *   - DATABASE_URL pointed at the same DB the dev server is using
 *
 * Override the target server with SCIM_SMOKE_BASE_URL; override the actor
 * recorded on the mint with SCIM_SMOKE_ADMIN_USER_ID (defaults to the seeded
 * SCIM provisioner user).
 *
 * Usage:
 *   pnpm scim:smoke
 *
 * Token safety: the plaintext bearer is held in a local const only; never
 * logged. The token is revoked in a `finally` block so even a mid-sequence
 * failure leaves no live bearer behind.
 */

import { IdpName } from "@prisma/client";

import { prisma } from "~/lib/prisma";
import { mintScimToken, revokeScimToken } from "~/lib/scim/tokens";
import {
  SCIM_CONTENT_TYPE,
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
} from "~/lib/scim/constants";

const BASE_URL =
  process.env.SCIM_SMOKE_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:3000";
const ADMIN_USER_ID =
  process.env.SCIM_SMOKE_ADMIN_USER_ID ?? SCIM_SYSTEM_USER_ID;

interface StepResult {
  label: string;
  pass: boolean;
  ms: number;
  error?: string;
}

const results: StepResult[] = [];

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function runStep(
  label: string,
  fn: () => Promise<void>
): Promise<StepResult> {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    const result: StepResult = { label, pass: true, ms };
    results.push(result);
    write(`[smoke] ${label.padEnd(48, ".")} PASS (${ms}ms)`);
    return result;
  } catch (err) {
    const ms = Date.now() - started;
    const reason = err instanceof Error ? err.message : String(err);
    const result: StepResult = { label, pass: false, ms, error: reason };
    results.push(result);
    write(`[smoke] ${label.padEnd(48, ".")} FAIL (${ms}ms) (${reason})`);
    return result;
  }
}

interface ScimResponse {
  status: number;
  body: unknown;
}

function makeRequest(bearer: string) {
  return async function request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ScimResponse> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearer}`,
      Accept: SCIM_CONTENT_TYPE,
    };
    if (body !== undefined) {
      headers["Content-Type"] = SCIM_CONTENT_TYPE;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  };
}

function expectStatus(got: number, want: number, ctx: string): void {
  if (got !== want) {
    throw new Error(`${ctx}: expected status ${want}, got ${got}`);
  }
}

function asObject(value: unknown, ctx: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${ctx}: expected object body`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, ctx: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${ctx}: expected array`);
  }
  return value;
}

function asString(value: unknown, ctx: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${ctx}: expected non-empty string`);
  }
  return value;
}

async function main(): Promise<void> {
  write(`[smoke] target ${BASE_URL}`);

  const ts = Date.now();
  const mint = await mintScimToken({
    name: `smoke-test-${ts}`,
    idpName: IdpName.OTHER,
    expiresAt: null,
    createdById: ADMIN_USER_ID,
  });
  const tokenId = mint.token.id;
  const request = makeRequest(mint.plaintext);

  let testUserId: string | null = null;
  let testGroupId: string | null = null;

  try {
    await runStep("GET /api/scim/v2/ServiceProviderConfig", async () => {
      const res = await request("GET", "/api/scim/v2/ServiceProviderConfig");
      expectStatus(res.status, 200, "ServiceProviderConfig");
      const body = asObject(res.body, "ServiceProviderConfig body");
      const schemas = asArray(body.schemas, "ServiceProviderConfig.schemas");
      if (!schemas.includes(SCIM_SCHEMAS.SERVICE_PROVIDER_CONFIG)) {
        throw new Error("schemas envelope missing ServiceProviderConfig URN");
      }
    });

    await runStep("POST /api/scim/v2/Users", async () => {
      const userName = `smoke-user-${ts}@smoke.test`;
      const res = await request("POST", "/api/scim/v2/Users", {
        schemas: [SCIM_SCHEMAS.CORE_USER],
        userName,
        emails: [{ value: userName, primary: true }],
        name: { givenName: "Smoke", familyName: "User" },
        active: true,
      });
      expectStatus(res.status, 201, "POST /Users");
      const body = asObject(res.body, "POST /Users body");
      testUserId = asString(body.id, "POST /Users.id");
    });

    await runStep("GET /api/scim/v2/Users", async () => {
      const res = await request("GET", "/api/scim/v2/Users");
      expectStatus(res.status, 200, "GET /Users");
      const body = asObject(res.body, "GET /Users body");
      if (typeof body.totalResults !== "number" || body.totalResults < 1) {
        throw new Error(
          `GET /Users.totalResults expected >= 1, got ${String(body.totalResults)}`
        );
      }
    });

    await runStep("GET /api/scim/v2/Users/{id}", async () => {
      if (!testUserId) throw new Error("no test user id captured");
      const res = await request("GET", `/api/scim/v2/Users/${testUserId}`);
      expectStatus(res.status, 200, "GET /Users/{id}");
      const body = asObject(res.body, "GET /Users/{id} body");
      const meta = asObject(body.meta, "GET /Users/{id}.meta");
      asString(meta.location, "GET /Users/{id}.meta.location");
    });

    await runStep("PATCH /api/scim/v2/Users/{id} active=false", async () => {
      if (!testUserId) throw new Error("no test user id captured");
      const res = await request("PATCH", `/api/scim/v2/Users/${testUserId}`, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      });
      expectStatus(res.status, 200, "PATCH /Users/{id}");
    });

    await runStep("POST /api/scim/v2/Groups", async () => {
      if (!testUserId) throw new Error("no test user id captured");
      const res = await request("POST", "/api/scim/v2/Groups", {
        schemas: [SCIM_SCHEMAS.CORE_GROUP],
        displayName: `smoke-group-${ts}`,
        members: [{ value: testUserId }],
      });
      expectStatus(res.status, 201, "POST /Groups");
      const body = asObject(res.body, "POST /Groups body");
      testGroupId = asString(body.id, "POST /Groups.id");
    });

    await runStep("GET /api/scim/v2/Groups", async () => {
      const res = await request("GET", "/api/scim/v2/Groups");
      expectStatus(res.status, 200, "GET /Groups");
      asObject(res.body, "GET /Groups body");
    });

    await runStep("GET /api/scim/v2/Groups/{id}", async () => {
      if (!testGroupId) throw new Error("no test group id captured");
      if (!testUserId) throw new Error("no test user id captured");
      const res = await request("GET", `/api/scim/v2/Groups/${testGroupId}`);
      expectStatus(res.status, 200, "GET /Groups/{id}");
      const body = asObject(res.body, "GET /Groups/{id} body");
      const members = asArray(body.members, "GET /Groups/{id}.members");
      const found = members.some((m) => {
        if (m === null || typeof m !== "object") return false;
        const value = (m as Record<string, unknown>).value;
        return typeof value === "string" && value === testUserId;
      });
      if (!found) {
        throw new Error("GET /Groups/{id}.members missing test user id");
      }
    });

    await runStep("PATCH /api/scim/v2/Groups/{id} add-member", async () => {
      if (!testGroupId) throw new Error("no test group id captured");
      if (!testUserId) throw new Error("no test user id captured");
      const res = await request("PATCH", `/api/scim/v2/Groups/${testGroupId}`, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          {
            op: "add",
            path: "members",
            value: [{ value: testUserId }],
          },
        ],
      });
      expectStatus(res.status, 200, "PATCH /Groups/{id}");
    });

    await runStep("DELETE /api/scim/v2/Groups/{id}", async () => {
      if (!testGroupId) throw new Error("no test group id captured");
      const res = await request("DELETE", `/api/scim/v2/Groups/${testGroupId}`);
      expectStatus(res.status, 204, "DELETE /Groups/{id}");
    });

    await runStep("DELETE /api/scim/v2/Users/{id}", async () => {
      if (!testUserId) throw new Error("no test user id captured");
      const res = await request("DELETE", `/api/scim/v2/Users/${testUserId}`);
      expectStatus(res.status, 204, "DELETE /Users/{id}");
    });
  } finally {
    await runStep("revoke smoke token", async () => {
      await revokeScimToken(tokenId, ADMIN_USER_ID);
    });
  }

  const totalMs = results.reduce((acc, r) => acc + r.ms, 0);
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  write(
    `[smoke] Total: ${passCount}/${results.length} PASS, ${failCount} FAIL — ${(
      totalMs / 1000
    ).toFixed(2)}s`
  );

  process.exit(failCount === 0 ? 0 : 1);
}

void main().finally(() => prisma.$disconnect());

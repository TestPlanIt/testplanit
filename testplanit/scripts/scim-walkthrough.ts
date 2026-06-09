#!/usr/bin/env tsx
/**
 * scim-walkthrough.ts — Fire ONE SCIM event at a time so a human can
 * review the resulting Slack message before moving on. State (test
 * user id, group id, bearer token) is persisted to /tmp between runs
 * so step N can target the resources created in earlier steps.
 *
 * Usage:
 *   pnpm tsx scripts/scim-walkthrough.ts <step>
 *
 * Steps:
 *    1  scim.user.created
 *    2  scim.user.updated           (rename + change displayName)
 *    3  scim.user.deactivated       (active=true → false)
 *    4  scim.user.activated         (active=false → true)
 *    5  scim.user.deleted           (DELETE /Users/{id})
 *    6  scim.group.created          (with 1 initial member)
 *    7  scim.group.updated          (rename displayName)
 *    8  scim.group.member_added     (add 1 user via PATCH)
 *    9  scim.group.member_removed   (remove 1 user via PATCH)
 *   10  scim.group.deleted          (DELETE /Groups/{id})
 *   11  scim.user.created.summary   (12 rapid POSTs against fresh window)
 *   12  scim.group.member_added.summary (12 rapid PATCH member-adds)
 *  reset  clear /tmp state + revoke held token
 *
 * Steps 1, 6, 11, 12 mint resources on the fly. Steps 2-5 reuse the
 * step-1 user; steps 7-10 reuse the step-6 group.
 *
 * Prerequisite: dev server running on http://localhost:3000 with the
 * worker process picking up the outbound webhook queue.
 */

import { IdpName } from "@prisma/client";
import { promises as fs } from "fs";

import { prisma } from "~/lib/prisma";
import { mintScimToken, revokeScimToken } from "~/lib/scim/tokens";
import {
  SCIM_CONTENT_TYPE,
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
} from "~/lib/scim/constants";

const STATE_PATH = "/tmp/scim-walkthrough-state.json";
const BASE_URL = "http://localhost:3000";

interface State {
  bearer: string;
  tokenId: string;
  ts: number;
  testUserId?: string;
  testUserName?: string;
  testGroupId?: string;
  extraUserIds?: string[];
  extraGroupIds?: string[];
}

async function readState(): Promise<State | null> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    return JSON.parse(raw) as State;
  } catch {
    return null;
  }
}

async function writeState(s: State): Promise<void> {
  await fs.writeFile(STATE_PATH, JSON.stringify(s, null, 2));
}

async function ensureState(): Promise<State> {
  const existing = await readState();
  if (existing) return existing;
  const ts = Date.now();
  const mint = await mintScimToken({
    name: `walkthrough-${ts}`,
    idpName: IdpName.OTHER,
    expiresAt: null,
    createdById: SCIM_SYSTEM_USER_ID,
  });
  const state: State = {
    bearer: mint.plaintext,
    tokenId: mint.token.id,
    ts,
    extraUserIds: [],
    extraGroupIds: [],
  };
  await writeState(state);
  return state;
}

interface ScimRes {
  status: number;
  body: unknown;
}

async function request(
  bearer: string,
  method: string,
  path: string,
  body?: unknown
): Promise<ScimRes> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    Accept: SCIM_CONTENT_TYPE,
  };
  if (body !== undefined) headers["Content-Type"] = SCIM_CONTENT_TYPE;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

function logRes(label: string, res: ScimRes): void {
  const summary =
    res.status >= 200 && res.status < 300
      ? "OK"
      : `FAIL ${JSON.stringify(res.body).slice(0, 200)}`;
  process.stdout.write(`[${label}] HTTP ${res.status} ${summary}\n`);
}

async function clearWindow(): Promise<void> {
  // Drop the per-config 5-min dedup window so summaries can fire cleanly.
  // The payloadDigest column is opaque (sha256), so we can't filter by
  // event-name prefix — clear the whole table. This script is a manual
  // walkthrough harness so collateral on other event types is acceptable.
  const deleted = await prisma.webhookEventDedup.deleteMany({});
  process.stdout.write(`[reset] cleared ${deleted.count} dedup rows\n`);
}

async function step(name: string): Promise<void> {
  if (name === "reset") {
    const s = await readState();
    if (s) {
      try {
        await revokeScimToken(s.tokenId, SCIM_SYSTEM_USER_ID);
      } catch (e) {
        process.stdout.write(`[reset] revoke failed: ${String(e)}\n`);
      }
    }
    await fs.rm(STATE_PATH, { force: true });
    await clearWindow();
    process.stdout.write("[reset] state cleared\n");
    return;
  }

  const s = await ensureState();

  switch (name) {
    case "1": {
      const userName = `walkthrough-user-${s.ts}@walkthrough.test`;
      const res = await request(s.bearer, "POST", "/api/scim/v2/Users", {
        schemas: [SCIM_SCHEMAS.CORE_USER],
        userName,
        emails: [{ value: userName, primary: true }],
        name: { givenName: "Walk", familyName: "Through" },
        active: true,
      });
      logRes("user.created", res);
      const body = res.body as { id?: string };
      if (body?.id) {
        s.testUserId = body.id;
        s.testUserName = userName;
        await writeState(s);
        process.stdout.write(`[user.created] id=${body.id}\n`);
      }
      break;
    }
    case "2": {
      if (!s.testUserId) throw new Error("run step 1 first");
      const res = await request(
        s.bearer,
        "PATCH",
        `/api/scim/v2/Users/${s.testUserId}`,
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "replace",
              path: "name.givenName",
              value: "Walter",
            },
            {
              op: "replace",
              path: "name.familyName",
              value: "Renamed",
            },
          ],
        }
      );
      logRes("user.updated", res);
      break;
    }
    case "3": {
      if (!s.testUserId) throw new Error("run step 1 first");
      const res = await request(
        s.bearer,
        "PATCH",
        `/api/scim/v2/Users/${s.testUserId}`,
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "active", value: false }],
        }
      );
      logRes("user.deactivated", res);
      break;
    }
    case "4": {
      if (!s.testUserId) throw new Error("run step 1 first");
      const res = await request(
        s.bearer,
        "PATCH",
        `/api/scim/v2/Users/${s.testUserId}`,
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "active", value: true }],
        }
      );
      logRes("user.activated", res);
      break;
    }
    case "5": {
      if (!s.testUserId) throw new Error("run step 1 first");
      const res = await request(
        s.bearer,
        "DELETE",
        `/api/scim/v2/Users/${s.testUserId}`
      );
      logRes("user.deleted", res);
      break;
    }
    case "6": {
      // Need a fresh user to be the initial group member (step 5 deleted ours).
      const userName = `walkthrough-member-${Date.now()}@walkthrough.test`;
      const userRes = await request(s.bearer, "POST", "/api/scim/v2/Users", {
        schemas: [SCIM_SCHEMAS.CORE_USER],
        userName,
        emails: [{ value: userName, primary: true }],
        name: { givenName: "Initial", familyName: "Member" },
        active: true,
      });
      const userBody = userRes.body as { id?: string };
      if (!userBody?.id) throw new Error("failed to create initial member");
      s.extraUserIds = [...(s.extraUserIds ?? []), userBody.id];

      // Now the group, with that user as initial member.
      const res = await request(s.bearer, "POST", "/api/scim/v2/Groups", {
        schemas: [SCIM_SCHEMAS.CORE_GROUP],
        displayName: `walkthrough-group-${s.ts}`,
        members: [{ value: userBody.id, display: "Initial Member" }],
      });
      logRes("group.created", res);
      const body = res.body as { id?: string };
      if (body?.id) {
        s.testGroupId = body.id;
        await writeState(s);
        process.stdout.write(`[group.created] id=${body.id}\n`);
      }
      break;
    }
    case "7": {
      if (!s.testGroupId) throw new Error("run step 6 first");
      const res = await request(
        s.bearer,
        "PATCH",
        `/api/scim/v2/Groups/${s.testGroupId}`,
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "replace",
              path: "displayName",
              value: `walkthrough-group-${s.ts}-renamed`,
            },
          ],
        }
      );
      logRes("group.updated", res);
      break;
    }
    case "8": {
      if (!s.testGroupId) throw new Error("run step 6 first");
      // Mint a new user to add as a member.
      const userName = `walkthrough-add-${Date.now()}@walkthrough.test`;
      const userRes = await request(s.bearer, "POST", "/api/scim/v2/Users", {
        schemas: [SCIM_SCHEMAS.CORE_USER],
        userName,
        emails: [{ value: userName, primary: true }],
        name: { givenName: "Newly", familyName: "Added" },
        active: true,
      });
      const userBody = userRes.body as { id?: string };
      if (!userBody?.id) throw new Error("failed to create user to add");
      s.extraUserIds = [...(s.extraUserIds ?? []), userBody.id];
      await writeState(s);

      const res = await request(
        s.bearer,
        "PATCH",
        `/api/scim/v2/Groups/${s.testGroupId}`,
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "add",
              path: "members",
              value: [{ value: userBody.id, display: "Newly Added" }],
            },
          ],
        }
      );
      logRes("group.member_added", res);
      break;
    }
    case "9": {
      if (!s.testGroupId) throw new Error("run step 6 first");
      const lastAdded = s.extraUserIds?.[s.extraUserIds.length - 1];
      if (!lastAdded) throw new Error("no member to remove — run step 8 first");
      const res = await request(
        s.bearer,
        "PATCH",
        `/api/scim/v2/Groups/${s.testGroupId}`,
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "remove",
              path: `members[value eq "${lastAdded}"]`,
            },
          ],
        }
      );
      logRes("group.member_removed", res);
      break;
    }
    case "10": {
      if (!s.testGroupId) throw new Error("run step 6 first");
      const res = await request(
        s.bearer,
        "DELETE",
        `/api/scim/v2/Groups/${s.testGroupId}`
      );
      logRes("group.deleted", res);
      break;
    }
    case "11": {
      await clearWindow();
      process.stdout.write(
        "[user.created.summary] firing 12 parallel POSTs against cleared window\n"
      );
      const promises = Array.from({ length: 12 }, (_, i) => {
        const userName = `walkthrough-bulk-${Date.now()}-${i}@walkthrough.test`;
        return request(s.bearer, "POST", "/api/scim/v2/Users", {
          schemas: [SCIM_SCHEMAS.CORE_USER],
          userName,
          emails: [{ value: userName, primary: true }],
          name: { givenName: `Bulk${i}`, familyName: "User" },
          active: true,
        });
      });
      const settled = await Promise.allSettled(promises);
      const ok = settled.filter(
        (r) => r.status === "fulfilled" && r.value.status === 201
      ).length;
      process.stdout.write(
        `[user.created.summary] ${ok}/12 created; expect 10 individual + 1 summary in Slack\n`
      );
      break;
    }
    case "12": {
      if (!s.testGroupId) throw new Error("run step 6 first");
      await clearWindow();
      process.stdout.write(
        "[group.member_added.summary] firing 12 parallel PATCH adds against cleared window\n"
      );
      // Mint 12 fresh users to add (so each add is unique).
      const minted = await Promise.all(
        Array.from({ length: 12 }, async (_, i) => {
          const userName = `walkthrough-bulkmember-${Date.now()}-${i}@walkthrough.test`;
          const res = await request(s.bearer, "POST", "/api/scim/v2/Users", {
            schemas: [SCIM_SCHEMAS.CORE_USER],
            userName,
            emails: [{ value: userName, primary: true }],
            name: { givenName: `Member${i}`, familyName: "Bulk" },
            active: true,
          });
          return (res.body as { id?: string })?.id;
        })
      );
      const userIds = minted.filter((u): u is string => !!u);
      // Clear the window AGAIN so the user.created bulk doesn't pollute
      // the member_added summary window.
      await clearWindow();
      const patches = userIds.map((uid, idx) =>
        request(s.bearer, "PATCH", `/api/scim/v2/Groups/${s.testGroupId!}`, {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "add",
              path: "members",
              value: [{ value: uid, display: `Bulk Member ${idx}` }],
            },
          ],
        })
      );
      const settled = await Promise.allSettled(patches);
      const ok = settled.filter(
        (r) => r.status === "fulfilled" && r.value.status === 200
      ).length;
      process.stdout.write(
        `[group.member_added.summary] ${ok}/${userIds.length} added; expect 10 individual + 1 summary in Slack\n`
      );
      break;
    }
    case "fold": {
      // Fire 5 more user.created events WITHOUT clearing the window.
      // Expectation: zero new Slack messages — every emit hits the
      // summary digest already in the dedup table and silently skips
      // via the P2002 catch.
      process.stdout.write(
        "[fold] firing 5 more POSTs against the SAME window — expect no new Slack messages\n"
      );
      const promises = Array.from({ length: 5 }, (_, i) => {
        const userName = `walkthrough-fold-${Date.now()}-${i}@walkthrough.test`;
        return request(s.bearer, "POST", "/api/scim/v2/Users", {
          schemas: [SCIM_SCHEMAS.CORE_USER],
          userName,
          emails: [{ value: userName, primary: true }],
          name: { givenName: `Fold${i}`, familyName: "Silently" },
          active: true,
        });
      });
      const settled = await Promise.allSettled(promises);
      const ok = settled.filter(
        (r) => r.status === "fulfilled" && r.value.status === 201
      ).length;
      process.stdout.write(
        `[fold] ${ok}/5 created via API; Slack channel should be SILENT\n`
      );
      break;
    }
    default:
      throw new Error(`unknown step: ${name}`);
  }
}

async function main(): Promise<void> {
  const stepArg = process.argv[2];
  if (!stepArg) throw new Error("usage: scim-walkthrough.ts <step|reset>");
  await step(stepArg);
}

void main()
  .catch((err) => {
    process.stderr.write(`ERROR ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

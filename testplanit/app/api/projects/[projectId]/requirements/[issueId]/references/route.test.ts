// Wave 0 scaffold, owner 27-08. POST attaches a manual traceability
// reference (LINK-03, D-09/D-10/D-11): an internal pick creates the join
// row directly; an external pick upserts an Issue shell through the
// existing guarded upsertLinkedIssueShell path first. Load-bearing:
// the shell payload never sends isRequirement or parentId (D-09) — a
// reference-created shell must never enter the requirements tree.
//
// Mirrors the co-located route unit-test convention this directory already
// uses (see covering-cases/route.test.ts): vi.mock of next-auth,
// ~/server/auth, ~/lib/authContext, ~/lib/db, then a makeRequest helper.
//
// Todo-only in this plan (27-01) — no route.ts exists yet at this path,
// so this file does not import "./route". 27-08 converts each title into a
// real assertion once the route lands.

import { NextRequest } from "next/server";
import { describe, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: { findFirst: vi.fn() },
    requirementIssueReference: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

function makeRequest(
  projectId = "5",
  issueId = "10",
  body?: unknown
): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/${issueId}/references`,
    {
      method: "POST",
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

const params = (projectId = "5", issueId = "10") => ({
  params: Promise.resolve({ projectId, issueId }),
});

describe("POST /api/projects/[projectId]/requirements/[issueId]/references", () => {
  it.todo("returns 401 without a session");
  it.todo("returns 400 for a non-integer project or issue id");
  it.todo(
    "returns 400 when the body names neither an internal issue nor an external issue"
  );
  it.todo("returns 400 when the referenced issue id equals the requirement id");
  it.todo(
    "returns 403 when the viewer's project scope excludes the requirement's project"
  );
  it.todo(
    "returns 403 when the viewer's project scope excludes the referenced internal issue's project"
  );
  it.todo(
    "returns 404 when the addressed id is not a live requirement in the project"
  );
  it.todo(
    "creates the join row through the enhanced client for an internal pick"
  );
  it.todo(
    "upserts the shell through upsertLinkedIssueShell for an external pick"
  );
  it.todo("never sends isRequirement or parentId in the shell payload");
  it.todo(
    "returns 200 without creating a duplicate when the pair already exists"
  );
});

// Keep the helpers referenced so lint's unused-vars rule stays quiet until
// 27-08 wires them into real assertions.
void makeRequest;
void params;

// Wave 0 scaffold, owner 27-08. DELETE removes a manual traceability
// reference (LINK-03, D-15): hard-deletes only the RequirementIssueReference
// join row — the referenced Issue row always survives, mirroring the
// sibling bare-join RepositoryCaseIssue unlink semantics.
//
// Mirrors the co-located route unit-test convention this directory already
// uses (see ../route.test.ts / covering-cases/route.test.ts): vi.mock of
// next-auth, ~/server/auth, ~/lib/authContext, ~/lib/db, then a makeRequest
// helper.
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
    requirementIssueReference: { findFirst: vi.fn(), delete: vi.fn() },
  },
}));

function makeRequest(
  projectId = "5",
  issueId = "10",
  referencedIssueId = "20"
): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/${issueId}/references/${referencedIssueId}`,
    { method: "DELETE" }
  );
}

const params = (projectId = "5", issueId = "10", referencedIssueId = "20") => ({
  params: Promise.resolve({ projectId, issueId, referencedIssueId }),
});

describe("DELETE /api/projects/[projectId]/requirements/[issueId]/references/[referencedIssueId]", () => {
  it.todo("returns 401 without a session");
  it.todo("returns 400 for a non-integer id in the path");
  it.todo(
    "returns 403 when the viewer's project scope excludes the requirement's project"
  );
  it.todo(
    "returns 404 when the addressed id is not a live requirement in the project"
  );
  it.todo("deletes only the join row and never touches the referenced Issue");
  it.todo("succeeds as a no-op when the pair does not exist");
});

// Keep the helpers referenced so lint's unused-vars rule stays quiet until
// 27-08 wires them into real assertions.
void makeRequest;
void params;

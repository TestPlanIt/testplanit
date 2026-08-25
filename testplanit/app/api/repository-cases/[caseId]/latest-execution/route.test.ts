// Wave 0 scaffold, owner 27-06. GET /api/repository-cases/[caseId]/latest-execution
// returns a single case's latest executed_at, sourced from the shared
// latestCaseResultsCte() union of manual + JUnit results (CONTEXT.md — the
// only source for "the case's last execution"; never re-derived).
//
// Mirrors the co-located route unit-test convention this directory already
// uses (see covering-cases/route.test.ts): vi.mock of next-auth,
// ~/server/auth, ~/lib/authContext, ~/lib/db, then a makeRequest helper.
//
// Todo-only in this plan (27-01) — no route.ts exists yet at this path,
// so this file does not import "./route". 27-06 converts each title into a
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
    repositoryCases: { findFirst: vi.fn() },
  },
}));

function makeRequest(caseId = "100"): NextRequest {
  return new NextRequest(
    `http://localhost/api/repository-cases/${caseId}/latest-execution`
  );
}

const params = (caseId = "100") => ({
  params: Promise.resolve({ caseId }),
});

describe("GET /api/repository-cases/[caseId]/latest-execution", () => {
  it.todo("returns 401 without a session");
  it.todo("returns 400 for a non-integer case id");
  it.todo("returns 404 when the case does not exist or is soft-deleted");
  it.todo(
    "returns 403 when the viewer's project scope excludes the case's own project"
  );
  it.todo(
    "returns the case's latest executed_at from the shared latest-results CTE"
  );
  it.todo(
    "returns null lastExecutedAt for a case that has never been executed"
  );
});

// Keep the helpers referenced so lint's unused-vars rule stays quiet until
// 27-06 wires them into real assertions.
void makeRequest;
void params;

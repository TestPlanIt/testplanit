import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the route handler.
vi.mock("@/lib/services/forge-jira-auth", () => ({
  authenticateForgeWrite: vi.fn(),
  forgeUserHasProjectAccess: vi.fn(),
  FORGE_CORS_HEADERS: {},
}));

vi.mock("@/lib/services/jira-panel-generation", () => ({
  listGenerationProjects: vi.fn(),
}));

vi.mock("@/lib/services/jira-panel-quickscript", () => ({
  listIssueLinkedCases: vi.fn(),
  listProjectExportTemplates: vi.fn(),
}));

vi.mock("@/lib/services/quickscript-generation", () => ({
  getQuickScriptReadiness: vi.fn(),
}));

import {
  authenticateForgeWrite,
  forgeUserHasProjectAccess,
} from "@/lib/services/forge-jira-auth";
import { listGenerationProjects } from "@/lib/services/jira-panel-generation";
import {
  listIssueLinkedCases,
  listProjectExportTemplates,
} from "@/lib/services/jira-panel-quickscript";
import { getQuickScriptReadiness } from "@/lib/services/quickscript-generation";

import { GET } from "./route";

const buildRequest = (qs: string): NextRequest =>
  new NextRequest(
    `http://localhost/api/integrations/jira/quickscript-context?${qs}`
  );

/** A case as `listIssueLinkedCases` returns it — only `projectId` matters here. */
const linkedCase = (id: number, projectId: number) => ({
  id,
  name: `Case ${id}`,
  displayKey: null,
  folder: "",
  projectId,
});

/**
 * A Jira project maps to many TestPlanIt projects, so every candidate here is
 * flagged `isDefaultForIssue` — exactly the shape that used to make selection
 * fall through to the alphabetically-first project.
 */
const ALL_MAPPED = [
  { id: 3, name: "Admin Tool", isDefaultForIssue: true },
  { id: 4, name: "Android", isDefaultForIssue: true },
  { id: 8, name: "Refract", isDefaultForIssue: true },
  { id: 9, name: "Web", isDefaultForIssue: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateForgeWrite).mockResolvedValue({
    ok: true,
    integrationId: 3,
    user: { id: 1 },
  } as never);
  vi.mocked(forgeUserHasProjectAccess).mockResolvedValue(true);
  vi.mocked(listGenerationProjects).mockResolvedValue(ALL_MAPPED);
  vi.mocked(listProjectExportTemplates).mockResolvedValue([]);
  vi.mocked(getQuickScriptReadiness).mockResolvedValue({
    quickScriptEnabled: true,
    hasActiveLlm: true,
    hasCodeContext: true,
  });
  vi.mocked(listIssueLinkedCases).mockResolvedValue([]);
});

describe("GET /api/integrations/jira/quickscript-context", () => {
  it("selects the project holding the issue's linked cases, not the first mapped one", async () => {
    vi.mocked(listIssueLinkedCases).mockResolvedValue([
      linkedCase(101, 8),
      linkedCase(102, 8),
    ]);

    const res = await GET(buildRequest("issueKey=ABT-1&issueId=1000"));
    const body = await res.json();

    expect(body.selectedProjectId).toBe(8);
    expect(body.linkedCases.map((c: { id: number }) => c.id)).toEqual([
      101, 102,
    ]);
  });

  it("searches every accessible project, not just the pre-selected one", async () => {
    await GET(buildRequest("issueKey=ABT-1&issueId=1000"));

    expect(listIssueLinkedCases).toHaveBeenCalledWith([3, 4, 8, 9], {
      issueKey: "ABT-1",
      issueId: "1000",
    });
  });

  it("returns per-project linked-case counts", async () => {
    vi.mocked(listIssueLinkedCases).mockResolvedValue([
      linkedCase(101, 8),
      linkedCase(102, 8),
      linkedCase(103, 9),
    ]);

    const res = await GET(buildRequest("issueKey=ABT-1&issueId=1000"));
    const body = await res.json();

    expect(
      Object.fromEntries(
        body.projects.map((p: { id: number; linkedCaseCount: number }) => [
          p.id,
          p.linkedCaseCount,
        ])
      )
    ).toEqual({ 3: 0, 4: 0, 8: 2, 9: 1 });
  });

  it("picks the project with the most linked cases when several have them", async () => {
    vi.mocked(listIssueLinkedCases).mockResolvedValue([
      linkedCase(101, 9),
      linkedCase(102, 8),
      linkedCase(103, 8),
    ]);

    const res = await GET(buildRequest("issueKey=ABT-1&issueId=1000"));
    const body = await res.json();

    expect(body.selectedProjectId).toBe(8);
    // Only the selected project's cases are offered as the source set.
    expect(body.linkedCases.map((c: { id: number }) => c.id)).toEqual([
      102, 103,
    ]);
  });

  it("keeps the mapped-first ordering as the tiebreak on equal counts", async () => {
    vi.mocked(listIssueLinkedCases).mockResolvedValue([
      linkedCase(101, 9),
      linkedCase(102, 8),
    ]);

    const res = await GET(buildRequest("issueKey=ABT-1&issueId=1000"));
    const body = await res.json();

    // `listGenerationProjects` already sorted mapped-first then by name, so the
    // earlier of the two tied projects wins.
    expect(body.selectedProjectId).toBe(8);
  });

  it("honours an explicit project choice even when it has no linked cases", async () => {
    vi.mocked(listIssueLinkedCases).mockResolvedValue([linkedCase(101, 8)]);

    const res = await GET(
      buildRequest("issueKey=ABT-1&issueId=1000&projectId=4")
    );
    const body = await res.json();

    expect(body.selectedProjectId).toBe(4);
    expect(body.linkedCases).toEqual([]);
  });

  it("falls back to the mapped project when no cases are linked anywhere", async () => {
    vi.mocked(listGenerationProjects).mockResolvedValue([
      { id: 9, name: "Web", isDefaultForIssue: false },
      { id: 8, name: "Refract", isDefaultForIssue: true },
    ]);

    const res = await GET(buildRequest("issueKey=RINT-1&issueId=1000"));
    const body = await res.json();

    expect(body.selectedProjectId).toBe(8);
  });

  it("ignores projects the mapped user cannot access", async () => {
    vi.mocked(forgeUserHasProjectAccess).mockImplementation(
      async (_user, projectId) => projectId !== 8
    );
    vi.mocked(listIssueLinkedCases).mockResolvedValue([linkedCase(103, 9)]);

    const res = await GET(buildRequest("issueKey=ABT-1&issueId=1000"));
    const body = await res.json();

    expect(listIssueLinkedCases).toHaveBeenCalledWith([3, 4, 9], {
      issueKey: "ABT-1",
      issueId: "1000",
    });
    expect(body.selectedProjectId).toBe(9);
  });
});

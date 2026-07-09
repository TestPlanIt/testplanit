import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/milestones/[milestoneId]/unlink (HOOK-03, Plan 05 Task 1).
 *
 * Path lives under [milestoneId], not the plan's literal [id] — Next.js
 * rejects sibling dynamic segments with different slug names; see
 * 19-02-SUMMARY.md's identical precedent for the SSE stream route and
 * this plan's own critical-deviations note.
 *
 * See: .planning/phases/19-webhooks-lifecycle/19-05-PLAN.md,
 *      app/api/milestones/[milestoneId]/members/overflow/route.ts (the
 *      strongest analog this route's server-side resolution + auth gate
 *      is modeled on).
 */

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    milestones: { findUnique: vi.fn() },
    integrationProject: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectMilestoneSyncAdmin: vi.fn(),
}));

vi.mock("~/lib/integrations/services/MilestoneSyncService", () => ({
  milestoneSyncService: {
    convertMilestoneToLocal: vi.fn(),
  },
}));

import { baseDb } from "~/lib/db";
import { authorizeProjectMilestoneSyncAdmin } from "~/lib/integrations/importAuthorization";
import { milestoneSyncService } from "~/lib/integrations/services/MilestoneSyncService";
import { getServerSession } from "next-auth";

import { POST } from "./route";

const params = (milestoneId: string) => ({
  params: Promise.resolve({ milestoneId }),
});

const createRequest = (): NextRequest =>
  new NextRequest("http://localhost/api/milestones/42/unlink", {
    method: "POST",
  });

const SYNCED_MILESTONE = {
  id: 42,
  projectId: 7,
  externalId: "10001",
  integrationId: 3,
};

describe("POST /api/milestones/[milestoneId]/unlink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    (baseDb.milestones.findUnique as any).mockResolvedValue(SYNCED_MILESTONE);
    (baseDb.integrationProject.findFirst as any).mockResolvedValue({
      id: "map-1",
    });
    (authorizeProjectMilestoneSyncAdmin as any).mockResolvedValue({
      ok: true,
      status: 200,
      projectId: 7,
      provider: "JIRA",
    });
    (milestoneSyncService.convertMilestoneToLocal as any).mockResolvedValue({
      success: true,
    });
  });

  it("a project-admin session unlinks — calls convertMilestoneToLocal with reason 'manual_unlink' attributed to the acting admin (WR-04), never the system actor", async () => {
    const res = await POST(createRequest(), params("42"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(milestoneSyncService.convertMilestoneToLocal).toHaveBeenCalledWith(
      baseDb,
      42,
      "manual_unlink",
      undefined,
      "user-1"
    );
  });

  it("a non-admin session gets 403 Forbidden", async () => {
    (authorizeProjectMilestoneSyncAdmin as any).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await POST(createRequest(), params("42"));

    expect(res.status).toBe(403);
    expect(milestoneSyncService.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("an unauthenticated session gets 401 Unauthorized", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await POST(createRequest(), params("42"));

    expect(res.status).toBe(401);
    expect(milestoneSyncService.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("a milestone with no externalId/integrationId (not synced) gets 400 Bad Request", async () => {
    (baseDb.milestones.findUnique as any).mockResolvedValue({
      id: 42,
      projectId: 7,
      externalId: null,
      integrationId: null,
    });

    const res = await POST(createRequest(), params("42"));

    expect(res.status).toBe(400);
    expect(milestoneSyncService.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("a missing/nonexistent milestone id gets 404 Not Found", async () => {
    (baseDb.milestones.findUnique as any).mockResolvedValue(null);

    const res = await POST(createRequest(), params("999"));

    expect(res.status).toBe(404);
    expect(milestoneSyncService.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("resolves projectId/integrationId/externalId from the milestone row server-side, never from client input", async () => {
    await POST(createRequest(), params("42"));

    expect(baseDb.milestones.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 } })
    );
    expect(authorizeProjectMilestoneSyncAdmin).toHaveBeenCalledWith(
      expect.anything(),
      SYNCED_MILESTONE.integrationId,
      "map-1"
    );
  });

  it("resolves the IntegrationProject mapping server-side before authorizing; missing mapping gets 404", async () => {
    (baseDb.integrationProject.findFirst as any).mockResolvedValue(null);

    const res = await POST(createRequest(), params("42"));

    expect(res.status).toBe(404);
    expect(authorizeProjectMilestoneSyncAdmin).not.toHaveBeenCalled();
    expect(milestoneSyncService.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("calling unlink twice on an already-detached milestone is idempotent (second call succeeds as a no-op)", async () => {
    (milestoneSyncService.convertMilestoneToLocal as any).mockResolvedValue({
      success: true,
      alreadyDetached: true,
    });

    const res = await POST(createRequest(), params("42"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});

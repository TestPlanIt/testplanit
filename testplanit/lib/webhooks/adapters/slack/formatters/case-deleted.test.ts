import { describe, expect, it } from "vitest";

import type { OutboundEnvelope } from "../../types";
import { formatCaseDeletedBlocks } from "./case-deleted";

function envelope(data: Record<string, unknown>): OutboundEnvelope {
  return {
    eventId: "evt_test",
    eventName: "case.deleted",
    eventTimestamp: "2026-06-10T12:00:00.000Z",
    tenantId: null,
    projectId: 1,
    projectName: "Demo Project",
    actorUserId: null,
    data,
  };
}

describe("formatCaseDeletedBlocks", () => {
  it("renders a red card with the case name and project", () => {
    const { body } = formatCaseDeletedBlocks(
      envelope({ id: 50, name: "Login case", projectId: 1 })
    );
    const payload = JSON.parse(body);
    expect(payload.text).toBe("Case deleted: Login case");
    expect(payload.attachments[0].color).toBe("#ef4444");
    const rendered = JSON.stringify(payload);
    expect(rendered).toContain("Case deleted");
    expect(rendered).toContain("*Login case*");
    expect(rendered).toContain("in Demo Project");
  });

  it("falls back to the id when no name is present", () => {
    const { body } = formatCaseDeletedBlocks(
      envelope({ id: 50, projectId: 1 })
    );
    expect(JSON.parse(body).text).toBe("Case deleted: Case #50");
  });
});

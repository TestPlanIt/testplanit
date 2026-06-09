import { describe, expect, it } from "vitest";

import type { OutboundEnvelope } from "../../types";
import { formatCaseUpdatedBlocks } from "./case-updated";

function envelope(data: Record<string, unknown>): OutboundEnvelope {
  return {
    eventId: "evt_test",
    eventName: "case.updated",
    eventTimestamp: "2026-06-09T12:00:00.000Z",
    tenantId: null,
    projectId: 1,
    projectName: "Demo Project",
    actorUserId: null,
    data,
  };
}

describe("formatCaseUpdatedBlocks", () => {
  it("renders resolved change rows with before → after values", () => {
    const { body } = formatCaseUpdatedBlocks(
      envelope({
        id: 50,
        projectId: 1,
        name: "Login case",
        changes: [
          { label: "State", from: "Active", to: "Draft", color: "#FFAA00" },
          { label: "Type", from: "Functional", to: "Security" },
        ],
      })
    );
    const payload = JSON.parse(body);
    expect(payload.text).toBe("Case updated: Login case");
    // Color bar comes from the change carrying a color (the state).
    expect(payload.attachments[0].color).toBe("#FFAA00");
    const rendered = JSON.stringify(payload);
    expect(rendered).toContain("*State:* `Active` → `Draft`");
    expect(rendered).toContain("*Type:* `Functional` → `Security`");
  });

  it("omits the color bar when no change carries a color", () => {
    const { body } = formatCaseUpdatedBlocks(
      envelope({
        id: 50,
        projectId: 1,
        name: "Login case",
        changes: [{ label: "Name", from: "old", to: "new" }],
      })
    );
    const payload = JSON.parse(body);
    expect(payload.attachments).toBeUndefined();
    expect(payload.blocks).toBeDefined();
  });

  it("caps at 8 rows with an overflow note", () => {
    const changes = Array.from({ length: 10 }, (_, i) => ({
      label: `F${i}`,
      from: "a",
      to: "b",
    }));
    const { body } = formatCaseUpdatedBlocks(
      envelope({ id: 1, projectId: 1, name: "C", changes })
    );
    expect(body).toContain("and 2 more changes");
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SYNTHETIC_TASK_ID, clickupAdapter } from "./clickup";
import type { ParsedWebhookPayload } from "./types";

const SECRET = "clickup-minted-secret";

function body(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

function sign(raw: Buffer, secret = SECRET): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

function signedHeaders(raw: Buffer, secret = SECRET): Headers {
  return new Headers({ "x-signature": sign(raw, secret) });
}

const STATUS_EVENT = {
  event: "taskStatusUpdated",
  task_id: "86c0xyz12",
  webhook_id: "wh-1",
  history_items: [
    {
      id: "h1",
      field: "status",
      before: { status: "to do", type: "open" },
      after: { status: "in progress", type: "custom" },
    },
  ],
};

describe("clickupAdapter (inbound webhook)", () => {
  it("declares the CLICKUP adapter type", () => {
    expect(clickupAdapter.adapterType).toBe("CLICKUP");
  });

  describe("verify", () => {
    it("accepts a correctly signed status event and reads the new status from history_items", () => {
      const raw = body(STATUS_EVENT);
      const result = clickupAdapter.verify(raw, signedHeaders(raw), SECRET);

      expect(result).toEqual({
        valid: true,
        payload: {
          eventType: "taskStatusUpdated",
          issueKey: "86c0xyz12",
          externalStatus: "in progress",
          synthetic: false,
          data: STATUS_EVENT,
        },
      });
    });

    it("rejects a missing signature header", () => {
      const raw = body(STATUS_EVENT);
      const result = clickupAdapter.verify(raw, new Headers(), SECRET);
      expect(result).toEqual({ valid: false, reason: "missing-signature" });
    });

    it("rejects a signature that is not a bare 64-char hex digest", () => {
      const raw = body(STATUS_EVENT);
      const prefixed = new Headers({ "x-signature": `sha256=${sign(raw)}` });
      expect(clickupAdapter.verify(raw, prefixed, SECRET)).toEqual({
        valid: false,
        reason: "malformed-signature",
      });
    });

    it("rejects a digest made with a different secret", () => {
      const raw = body(STATUS_EVENT);
      const result = clickupAdapter.verify(
        raw,
        signedHeaders(raw, "some-other-secret"),
        SECRET
      );
      expect(result).toEqual({ valid: false, reason: "signature-mismatch" });
    });

    it("rejects a digest that was computed over different bytes", () => {
      const raw = body(STATUS_EVENT);
      const tampered = body({ ...STATUS_EVENT, task_id: "attacker" });
      const result = clickupAdapter.verify(
        tampered,
        signedHeaders(raw),
        SECRET
      );
      expect(result).toEqual({ valid: false, reason: "signature-mismatch" });
    });

    it("accepts an upper-case hex digest", () => {
      const raw = body(STATUS_EVENT);
      const headers = new Headers({ "x-signature": sign(raw).toUpperCase() });
      expect(clickupAdapter.verify(raw, headers, SECRET).valid).toBe(true);
    });

    it("rejects a body that is not JSON once the signature checks out", () => {
      const raw = Buffer.from("not json", "utf8");
      const result = clickupAdapter.verify(raw, signedHeaders(raw), SECRET);
      expect(result).toEqual({ valid: false, reason: "unparseable-body" });
    });

    it("requires an event name", () => {
      const raw = body({ task_id: "86c0xyz12", history_items: [] });
      const result = clickupAdapter.verify(raw, signedHeaders(raw), SECRET);
      expect(result).toEqual({
        valid: false,
        reason: "missing-required-field",
      });
    });

    it("leaves the status empty on events that carry none", () => {
      const event = {
        event: "taskPriorityUpdated",
        task_id: "86c0xyz12",
        history_items: [
          { field: "priority", before: null, after: { priority: "high" } },
        ],
      };
      const raw = body(event);
      const result = clickupAdapter.verify(raw, signedHeaders(raw), SECRET);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.externalStatus).toBe("");
        expect(result.payload.issueKey).toBe("86c0xyz12");
      }
    });

    it("flags the synthetic sentinel task id", () => {
      const event = { ...STATUS_EVENT, task_id: SYNTHETIC_TASK_ID };
      const raw = body(event);
      const result = clickupAdapter.verify(raw, signedHeaders(raw), SECRET);
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.payload.synthetic).toBe(true);
    });
  });

  describe("extractLinkedIssueRef", () => {
    it("keys the linked issue by the ClickUp task id", () => {
      const parsed: ParsedWebhookPayload = {
        eventType: "taskStatusUpdated",
        issueKey: "86c0xyz12",
        externalStatus: "in progress",
        synthetic: false,
        data: STATUS_EVENT,
      };
      expect(clickupAdapter.extractLinkedIssueRef(parsed)).toEqual({
        externalKey: "86c0xyz12",
        externalSystem: "CLICKUP",
        externalId: "86c0xyz12",
      });
    });

    it("returns null without a task id", () => {
      expect(
        clickupAdapter.extractLinkedIssueRef({
          event: "listUpdated",
          list_id: "901",
        })
      ).toBeNull();
    });
  });

  describe("extractExternalStatus", () => {
    it("reads a new task's first status from taskCreated", () => {
      const created = {
        event: "taskCreated",
        task_id: "1vj37mc",
        history_items: [
          {
            field: "status",
            before: { status: null },
            after: { status: "to do" },
          },
          { field: "task_creation", before: null, after: null },
        ],
      };
      expect(clickupAdapter.extractExternalStatus(created, "taskCreated")).toBe(
        "to do"
      );
    });

    it("treats taskCreated as an issue event even without a status item", () => {
      expect(
        clickupAdapter.extractExternalStatus(
          { event: "taskCreated", task_id: "1vj37mc", history_items: [] },
          "taskCreated"
        )
      ).toBe("");
    });

    it("returns the new status for taskStatusUpdated", () => {
      expect(
        clickupAdapter.extractExternalStatus(STATUS_EVENT, "taskStatusUpdated")
      ).toBe("in progress");
    });

    it("returns null for every other event so the receiver records no_handler", () => {
      expect(
        clickupAdapter.extractExternalStatus(
          { ...STATUS_EVENT, event: "taskUpdated" },
          "taskUpdated"
        )
      ).toBeNull();
    });

    it("returns null when the status history item has no after value", () => {
      const event = {
        event: "taskStatusUpdated",
        task_id: "86c0xyz12",
        history_items: [
          { field: "status", before: { status: "x" }, after: null },
        ],
      };
      expect(
        clickupAdapter.extractExternalStatus(event, "taskStatusUpdated")
      ).toBeNull();
    });
  });
});

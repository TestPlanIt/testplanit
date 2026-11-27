import { describe, expect, it } from "vitest";
import { getAdapter } from "~/lib/webhooks/adapters";
import messages from "~/messages/en-US.json";
import {
  ISSUE_SETUP_STEP_KEYS,
  type IssueInboundAdapterType,
} from "./inbound-adapters";

const strings = messages.projects.settings.webhooks as Record<string, unknown>;
const adapterTypes = Object.keys(
  ISSUE_SETUP_STEP_KEYS
) as IssueInboundAdapterType[];

describe("issue webhook setup steps", () => {
  it.each(adapterTypes)("every %s step has an English string", (type) => {
    for (const key of ISSUE_SETUP_STEP_KEYS[type]) {
      expect(typeof strings[key], key).toBe("string");
    }
  });

  it.each(adapterTypes)(
    "the %s steps mention milestone events exactly when the tracker sends them",
    (type) => {
      const sendsMilestoneEvents =
        typeof getAdapter(type).extractMilestoneEventRef === "function";
      const mentionsMilestones = ISSUE_SETUP_STEP_KEYS[type].some((key) =>
        String(strings[key]).includes("syncs milestones from")
      );

      expect(mentionsMilestones).toBe(sendsMilestoneEvents);
    }
  );
});

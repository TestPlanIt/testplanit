// Stub — full implementation lands in Task 2.2.
// This file exists so the registry import in ./index.ts resolves;
// `index.test.ts` mocks `./jira` via `vi.mock` so this stub is not exercised.
import type { WebhookAdapter } from "./types";

export const jiraAdapter: WebhookAdapter = {
  adapterType: "JIRA",
  verify() {
    throw new Error("jiraAdapter not yet implemented (Task 2.2)");
  },
};

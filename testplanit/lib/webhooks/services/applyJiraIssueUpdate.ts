/**
 * @deprecated Phase 3 P-02 renamed this service to `applyInboundIssueUpdate`
 * (adapter-agnostic, parametrized by `adapterType`). This file is a thin
 * back-compat shim so the existing receiver call site in
 * `app/api/webhooks/[token]/route.ts` keeps compiling until P-05 updates
 * it to import the new name + pass `adapterType` + `eventType` directly.
 *
 * P-05 deletes this shim file.
 *
 * Behavior is identical to calling `applyInboundIssueUpdate` with
 * `adapterType: "JIRA"` and `eventType: input.payload.eventType` — every
 * Phase 1 caller flowed through the Jira adapter only, so binding the
 * adapter to JIRA is correct for all current callers.
 */

import { applyInboundIssueUpdate } from "./applyInboundIssueUpdate";
import type {
  ApplyInboundIssueUpdateInput,
  ApplyInboundIssueUpdateResult,
} from "./types";

/**
 * @deprecated Phase 3 P-02 renamed to `applyInboundIssueUpdate`. Use the new
 * function name and pass `adapterType` + `eventType` explicitly. P-05 deletes
 * this wrapper.
 */
export async function applyJiraIssueUpdate(
  input: Omit<ApplyInboundIssueUpdateInput, "adapterType" | "eventType"> &
    Partial<Pick<ApplyInboundIssueUpdateInput, "adapterType" | "eventType">>
): Promise<ApplyInboundIssueUpdateResult> {
  return applyInboundIssueUpdate({
    ...input,
    adapterType: input.adapterType ?? "JIRA",
    eventType: input.eventType ?? input.payload.eventType,
  });
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

interface LinkUnlinkResponseBody {
  error?: string;
}

// Generalised from the original link/unlink-only postLinkAction (WR-02,
// 27.1-05) so dismissSuspect below can reuse the identical error-extraction
// logic against a different body shape. The link/unlink call sites' request
// bodies are unchanged by this generalisation -- `{ entityType: "testCase",
// entityId: caseId }`, byte-identical to before.
async function postJson(
  url: string,
  body: unknown,
  fallbackMessage: string
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = fallbackMessage;
    try {
      const data = (await res.json()) as LinkUnlinkResponseBody;
      if (data?.error) message = data.error;
    } catch {
      // Response body wasn't JSON -- fall back to the generic message.
    }
    throw new Error(message);
  }
}

/**
 * The shared link/unlink/dismiss contract for both directions of the
 * requirement <-> test case relationship: this panel's own
 * LinkedRequirementCasesPanel (the requirement surface) and the case-detail
 * LinkedRequirementsPanel (the case surface). Both directions post to the
 * same, unmodified `/api/issues/[issueId]/link` and `/unlink` routes -- the
 * requirement's `issueId` is ALWAYS the path parameter and the case id is
 * ALWAYS `entityId`, regardless of which surface initiated the call.
 * `dismissSuspect` (WR-02, 27.1-05) keeps the identical argument order --
 * requirement first, case second -- so the two surfaces cannot get the
 * direction backwards there either.
 *
 * Deliberately no toasts here -- the call sites use different i18n keys
 * (`requirements.linkedCases.*` vs `requirements.linkedRequirements.*`), so
 * each panel surfaces its own success/error message around these calls.
 */
export function useRequirementCaseLinks() {
  const queryClient = useQueryClient();
  const [isMutating, setIsMutating] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const invalidateLinkedQueries = useCallback(() => {
    // A predicate, not a key prefix -- ZenStack query keys need a predicate
    // to narrow correctly in this codebase (a bare prefix match doesn't
    // behave the way it looks like it should). Both models participate in
    // the join from either direction, so both must be covered, matching the
    // shipped `JSON.stringify(queryKey).includes(...)` idiom
    // (MilestoneDisplay.tsx).
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const key = JSON.stringify(query.queryKey);
        return key.includes("RepositoryCases") || key.includes("Issue");
      },
    });
  }, [queryClient]);

  const link = useCallback(
    async (requirementId: number, caseId: number) => {
      setIsMutating(true);
      try {
        await postJson(
          `/api/issues/${requirementId}/link`,
          { entityType: "testCase", entityId: caseId },
          "Failed to link test case."
        );
        invalidateLinkedQueries();
      } finally {
        setIsMutating(false);
      }
    },
    [invalidateLinkedQueries]
  );

  const unlink = useCallback(
    async (requirementId: number, caseId: number) => {
      setIsMutating(true);
      try {
        await postJson(
          `/api/issues/${requirementId}/unlink`,
          { entityType: "testCase", entityId: caseId },
          "Failed to unlink test case."
        );
        invalidateLinkedQueries();
      } finally {
        setIsMutating(false);
      }
    },
    [invalidateLinkedQueries]
  );

  // WR-02 (27.1-05): posts to the server-clock dismissal route rather than
  // stamping `new Date()` in the browser -- see that route's own doc comment
  // for why the clock family matters. Deliberately does NOT call
  // invalidateLinkedQueries or either coverage invalidator: a dismissal is
  // data-shape-inert to both the link/unlink caches and to coverage, exactly
  // as both panels' own dismissal handlers already assume. Uses its own
  // isDismissing flag, never isMutating -- the link/unlink buttons gate on
  // isMutating and must stay independently enabled while a dismissal is in
  // flight (and vice versa).
  const dismissSuspect = useCallback(
    async (requirementId: number, caseId: number) => {
      setIsDismissing(true);
      try {
        await postJson(
          `/api/repository-cases/${caseId}/suspect-dismissal`,
          { issueId: requirementId },
          "Failed to dismiss suspect flag."
        );
      } finally {
        setIsDismissing(false);
      }
    },
    []
  );

  return { link, unlink, isMutating, dismissSuspect, isDismissing };
}

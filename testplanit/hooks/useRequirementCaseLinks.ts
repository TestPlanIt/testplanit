"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

interface LinkUnlinkResponseBody {
  error?: string;
}

async function postLinkAction(
  url: string,
  caseId: number,
  fallbackMessage: string
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType: "testCase", entityId: caseId }),
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
 * The shared link/unlink contract for both directions of the requirement
 * <-> test case relationship: this panel's own LinkedRequirementCasesPanel
 * (the requirement surface) and the case-detail "Linked Requirements" panel
 * a later plan builds. Both directions post to the same, unmodified
 * `/api/issues/[issueId]/link` and `/unlink` routes -- the requirement's
 * `issueId` is ALWAYS the path parameter and the case id is ALWAYS
 * `entityId`, regardless of which surface initiated the call. Encoding that
 * direction once here is what stops the two panels from drifting apart or
 * getting the direction backwards.
 *
 * Deliberately no toasts here -- the two call sites use different i18n keys
 * (`requirements.linkedCases.*` vs `requirements.linkedRequirements.*`), so
 * each panel surfaces its own success/error message around these calls.
 */
export function useRequirementCaseLinks() {
  const queryClient = useQueryClient();
  const [isMutating, setIsMutating] = useState(false);

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
        await postLinkAction(
          `/api/issues/${requirementId}/link`,
          caseId,
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
        await postLinkAction(
          `/api/issues/${requirementId}/unlink`,
          caseId,
          "Failed to unlink test case."
        );
        invalidateLinkedQueries();
      } finally {
        setIsMutating(false);
      }
    },
    [invalidateLinkedQueries]
  );

  return { link, unlink, isMutating };
}

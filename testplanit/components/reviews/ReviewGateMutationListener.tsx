"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

type ReviewGateErrorCode = "REVIEW_REQUIRED" | "PENDING_REVIEW_EXISTS";

function extractReviewGateCode(err: unknown): ReviewGateErrorCode | null {
  if (err === null || typeof err !== "object") return null;
  const info = (err as { info?: unknown }).info;
  const code =
    info !== null && typeof info === "object"
      ? (info as { code?: unknown }).code
      : undefined;
  if (code === "REVIEW_REQUIRED" || code === "PENDING_REVIEW_EXISTS") {
    return code;
  }
  return null;
}

/**
 * Subscribes to TanStack Query's mutation cache and shows a toast whenever a
 * mutation rejects with a server-side review-gate code (REVIEW_REQUIRED or
 * PENDING_REVIEW_EXISTS). The toast is the "server safety net" for cases the
 * client-side useTransitionGateStatus pre-check missed — stale workflow data
 * cached on the page, a race between two callers consuming the same approval,
 * or an in-flight Decide / Cancel that lands between the pre-check and the
 * mutation.
 *
 * Only covers ZenStack-generated mutation hooks (anything routed through
 * useMutation). Raw fetch() callers — e.g. the bulk-edit POST — surface the
 * same codes via inline error handling at their call site.
 *
 * Lives inside the locale layout so it has access to NextIntl translations.
 */
export function ReviewGateMutationListener() {
  const queryClient = useQueryClient();
  const t = useTranslations("reviews.transitionGate");

  useEffect(() => {
    const cache = queryClient.getMutationCache();
    const notified = new WeakSet<object>();
    return cache.subscribe((event) => {
      if (event.type !== "updated") return;
      const mutation = event.mutation;
      if (!mutation || mutation.state.status !== "error") return;
      if (notified.has(mutation)) return;
      const code = extractReviewGateCode(mutation.state.error);
      if (!code) return;
      notified.add(mutation);
      toast.error(
        code === "REVIEW_REQUIRED"
          ? t("toastReviewRequired")
          : t("toastPendingReviewExists")
      );
    });
  }, [queryClient, t]);

  return null;
}

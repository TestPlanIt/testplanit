"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

/** "webhook-dispatch" → "Webhook Dispatch" for queues without a curated label. */
export function humanizeQueueName(name: string): string {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The display name of a background queue, shared by the admin Queues page
 * and the queue alerts: the curated label under `admin.queues.queueNames`
 * when there is one, otherwise the humanized queue name.
 */
export function useQueueDisplayName(): (name: string) => string {
  const t = useTranslations("admin.queues.queueNames");
  const tGlobal = useTranslations();
  return useCallback(
    (name: string) => {
      if (name === "notifications")
        return tGlobal("common.fields.notificationMode");
      return t.has(name as never) ? t(name as never) : humanizeQueueName(name);
    },
    [t, tGlobal]
  );
}

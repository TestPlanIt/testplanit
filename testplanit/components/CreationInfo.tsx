"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import { UserDisplay } from "@/components/search/UserDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CalendarClock, User } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React, { useCallback, useRef, useState } from "react";
import { cn, type ClassValue } from "~/utils";

export interface CreationInfoProps {
  userId?: string | null;
  createdAt?: Date | string | null;
  className?: ClassValue;
}

export const CreationInfo: React.FC<CreationInfoProps> = ({
  userId,
  createdAt,
  className,
}) => {
  const t = useTranslations();
  const { data: session } = useSession();
  const { data: user } = useClientQueries(schema).user.useFindFirst(
    {
      where: { id: userId ?? "" },
      select: { name: true, image: true },
    },
    { enabled: !!userId }
  );

  // When the component is very narrow (e.g. the details side-panel in a slim
  // browser), collapse the "Created by/at" text labels into icons so the actual
  // value (name/date) keeps the room. Measured synchronously on attach so a
  // remount doesn't flash the wide layout.
  const [narrow, setNarrow] = useState(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    if (node && typeof ResizeObserver !== "undefined") {
      setNarrow(node.offsetWidth > 0 && node.offsetWidth < 220);
      const ro = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        setNarrow(width > 0 && width < 220);
      });
      ro.observe(node);
      resizeObserverRef.current = ro;
    }
  }, []);

  if (!userId && !createdAt) {
    return null;
  }

  const createdByLabel = t("common.fields.createdBy");
  const createdAtLabel = t("common.fields.createdAt");

  return (
    <div ref={setRootRef} className={cn("space-y-2 w-full", className)}>
      {userId && user?.name && (
        <div className="flex items-center gap-2 text-sm min-w-0 w-full">
          {narrow && (
            <Tooltip>
              <TooltipTrigger asChild>
                <User
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-label={createdByLabel}
                />
              </TooltipTrigger>
              <TooltipContent>{createdByLabel}</TooltipContent>
            </Tooltip>
          )}
          <UserDisplay
            userId={userId}
            userName={user.name ?? undefined}
            userImage={user.image}
            prefix={narrow ? undefined : createdByLabel}
            size="small"
          />
        </div>
      )}
      {createdAt && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 w-full">
          {narrow ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <CalendarClock
                  className="h-4 w-4 shrink-0"
                  aria-label={createdAtLabel}
                />
              </TooltipTrigger>
              <TooltipContent>{createdAtLabel}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="shrink-0">{createdAtLabel}:</span>
          )}
          <span className="truncate">
            <DateFormatter
              date={createdAt}
              formatString={
                (session?.user.preferences?.dateFormat || "MM-dd-yyyy") +
                " " +
                (session?.user.preferences?.timeFormat || "HH:mm")
              }
              timezone={session?.user.preferences?.timezone}
            />
          </span>
        </div>
      )}
    </div>
  );
};

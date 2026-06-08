"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { UserDisplay } from "@/components/search/UserDisplay";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React from "react";
import { useFindFirstUser } from "~/lib/hooks";
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
  const { data: user } = useFindFirstUser(
    {
      where: { id: userId ?? "" },
      select: { name: true, image: true },
    },
    { enabled: !!userId }
  );

  if (!userId && !createdAt) {
    return null;
  }

  return (
    <div className={cn("space-y-2 w-full", className)}>
      {userId && user?.name && (
        <div className="flex items-center gap-2 min-w-0 w-full">
          <UserDisplay
            userId={userId}
            userName={user.name ?? undefined}
            userImage={user.image}
            prefix={t("common.fields.createdBy")}
            size="large"
          />
        </div>
      )}
      {createdAt && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 w-full">
          <span className="shrink-0">{t("common.fields.createdAt")}:</span>
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

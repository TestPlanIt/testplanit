"use client";

import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A synced milestone's `externalUrl` is tracker-provided and written through
 * the raw db client, which bypasses the schema's `@url` validation — so only
 * treat http(s) URLs as linkable (never `javascript:` etc.) and open without
 * an opener reference to prevent reverse tab-nabbing.
 */
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

export interface MilestoneSourceBadgeMilestone {
  integrationId: number | null;
  externalKind: string | null;
  externalState: string | null;
  externalUrl: string | null;
}

interface MilestoneSourceBadgeProps {
  milestone: MilestoneSourceBadgeMilestone;
  className?: string;
}

/**
 * The "Jira · Sprint · active" source badge shown on synced milestones
 * (LOCK-05). When a safe external URL is stored, the badge itself is the
 * open-in-tracker link and the external-link icon fades in on hover.
 * Renders nothing for local milestones.
 */
export function MilestoneSourceBadge({
  milestone,
  className,
}: MilestoneSourceBadgeProps) {
  const t = useTranslations("milestones");

  if (milestone.integrationId == null) return null;

  const safeExternalUrl =
    milestone.externalUrl && SAFE_EXTERNAL_URL_RE.test(milestone.externalUrl)
      ? milestone.externalUrl
      : null;

  const badgeLabel = t("sync.sourceBadge", {
    provider: t("sync.providerJira"),
    kind:
      milestone.externalKind === "RELEASE"
        ? t("import.kindRelease")
        : t("import.kindSprint"),
    state: milestone.externalState ?? "",
  });

  return (
    <Badge
      data-testid="milestone-source-badge"
      variant="secondary"
      role={safeExternalUrl ? "link" : undefined}
      title={safeExternalUrl ? t("sync.openInJira") : undefined}
      className={`text-xs shrink-0 gap-1 ${
        safeExternalUrl ? "group cursor-pointer hover:bg-secondary/80" : ""
      } ${className ?? ""}`}
      onClick={
        safeExternalUrl
          ? (e) => {
              // Cards live inside clickable rows — never bubble into row
              // navigation.
              e.stopPropagation();
              window.open(safeExternalUrl, "_blank", "noopener,noreferrer");
            }
          : undefined
      }
    >
      {badgeLabel}
      {safeExternalUrl && (
        <ExternalLink
          data-testid="milestone-open-in-tracker"
          className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}
    </Badge>
  );
}

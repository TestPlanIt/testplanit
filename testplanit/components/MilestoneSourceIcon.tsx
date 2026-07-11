"use client";

import { useTranslations } from "next-intl";
import { siJira } from "simple-icons";

/**
 * Milestone fields the icon needs — all optional so any caller can pass its
 * (possibly narrower) milestone object; the icon simply hides when linkage
 * fields are absent.
 */
interface MilestoneSourceIconMilestone {
  integrationId?: number | null;
  externalKind?: string | null;
  detachedAt?: Date | string | null;
}

interface MilestoneSourceIconProps {
  milestone: MilestoneSourceIconMilestone;
  className?: string;
}

/**
 * Icon-only tracker-link marker for milestone mentions OUTSIDE the
 * milestones pages (session/run groupings, child lists, pickers, admin
 * tables) — the milestones pages themselves render the full
 * MilestoneSourceBadge with its segment collapse and admin menu. This is a
 * plain glyph + tooltip: fixed icon width (`shrink-0`) so the milestone
 * name keeps all remaining space, no anchor (it often nests inside a Link),
 * no per-instance measurement or permissions fetch.
 *
 * Rendered only while the milestone is actively tracked
 * (`integrationId != null && detachedAt == null`) — detached (converted to
 * local) milestones are deliberately unmarked here, matching the
 * no-badge-for-manual-unlink rule (D-11).
 */
export function MilestoneSourceIcon({
  milestone,
  className,
}: MilestoneSourceIconProps) {
  const t = useTranslations("milestones");

  if (milestone.integrationId == null || milestone.detachedAt != null) {
    return null;
  }

  const provider = t("sync.providerJira");
  const kind =
    milestone.externalKind === "RELEASE"
      ? t("import.kindRelease")
      : milestone.externalKind === "ITERATION"
        ? t("import.kindSprint")
        : null;
  const label = kind ? `${provider} · ${kind}` : provider;

  return (
    <span
      className={`inline-flex shrink-0 items-center ${className ?? ""}`}
      title={label}
      aria-label={label}
      data-testid="milestone-source-icon"
    >
      <svg
        role="img"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 fill-[#2684FF]"
        aria-hidden="true"
      >
        <path d={siJira.path} />
      </svg>
    </span>
  );
}

"use client";

import { useState, type ReactElement } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExternalLink, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "~/lib/navigation";
import { toast } from "sonner";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { isRequirementLocked } from "~/lib/services/linkedIssueUpsert";
import { JiraGlyph } from "@/components/MilestoneSourceBadge";

/**
 * A synced requirement's `externalUrl` is tracker-provided and some sync
 * paths write it through the raw db client, which bypasses the schema's
 * `@url` validation — so only treat http(s) URLs as linkable (never
 * `javascript:` etc.) and open without an opener reference to prevent
 * reverse tab-nabbing. Mirrors `MilestoneSourceBadge.tsx`'s identical guard.
 */
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

export interface RequirementProvenanceBadgeRow {
  id: number;
  isRequirement: boolean;
  integrationId: number | null;
  requirementDetachedAt: Date | string | null;
  externalKey?: string | null;
  externalUrl?: string | null;
  issueTypeIconUrl?: string | null;
}

interface RequirementProvenanceBadgeProps {
  requirement: RequirementProvenanceBadgeRow;
  projectId: number;
  /** Lets a parent invalidate its own query instead of relying on a router
   *  refresh after a successful detach. */
  onDetached?: () => void;
  className?: string;
}

/**
 * PROV-01/02/03's three-state provenance badge, plus the detach action.
 *
 * - **Native** (`integrationId == null`): a subtle local tag. Never a lock.
 * - **Synced + locked** (`isRequirementLocked(requirement)`): the locked
 *   badge, with a project-admin-gated "Detach" action.
 * - **Detached** (`integrationId != null && requirementDetachedAt != null`):
 *   the same tracker reference stays visible, never a lock — PROV-03:
 *   detached and native reach the SAME editable state; this badge only
 *   differs in showing provenance, never in implying different editability.
 *
 * Forked from `components/MilestoneSourceBadge.tsx`'s
 * `SourceBadgeWithUnlinkMenu` shape (the "simpler two-state cousin" per
 * 25-CONTEXT.md). Deliberately excludes that file's permanent removed/merged
 * badge branch and its project-space resolver — both are driven by a
 * webhook `externalState` (deleted/merged) lifecycle that `Issue` does not
 * have; requirements only ever have the three states listed above.
 */
export function RequirementProvenanceBadge({
  requirement,
  projectId,
  onDetached,
  className,
}: RequirementProvenanceBadgeProps) {
  const t = useTranslations("requirements.provenance");
  // Reuse the provider label the milestone sync badge already ships
  // (`milestones.sync.providerJira`) rather than adding a second key that
  // just says "Jira".
  const provider = useTranslations("milestones")("sync.providerJira");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const { isProjectAdmin } = useProjectPermissions(projectId);

  const isNative = requirement.integrationId == null;
  const locked = isRequirementLocked(requirement);
  const isDetached =
    requirement.integrationId != null &&
    requirement.requirementDetachedAt != null;

  const trackerUrl =
    requirement.externalUrl &&
    SAFE_EXTERNAL_URL_RE.test(requirement.externalUrl)
      ? requirement.externalUrl
      : null;
  const canOpenInTracker = Boolean(trackerUrl);

  const openInTracker = () => {
    if (!trackerUrl) return;
    window.open(trackerUrl, "_blank", "noopener,noreferrer");
  };

  const handleDetach = async () => {
    setIsDetaching(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/${requirement.id}/detach`,
        { method: "POST" }
      );
      if (!res.ok) {
        throw new Error(`Detach failed with status ${res.status}`);
      }
      toast.success(t("detachSuccess"));
      setConfirmOpen(false);
      onDetached?.();
      router.refresh();
    } catch (err) {
      console.error("Failed to detach requirement:", err);
      toast.error(t("detachFailed"));
    } finally {
      setIsDetaching(false);
    }
  };

  const withTooltip = (node: ReactElement, tooltipText: string) => (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );

  const label = locked ? t("syncedLabel") : t("detachedLabel");
  const tooltipText = locked ? t("syncedTooltip") : t("detachedTooltip");
  const testId = locked
    ? "requirement-provenance-locked"
    : "requirement-provenance-detached";

  // Progressive collapse (drop "· Synced", then "Jira", keeping the mark) is
  // NOT implemented yet. A first attempt measured segment widths from an
  // absolutely-positioned hidden copy, which left the wrapper reporting
  // ~zero width: the badge never collapsed and the requirement's title
  // truncated instead — the opposite of the intent. Doing this properly
  // needs the width-competition half of MilestoneSourceBadge (a VISIBLE
  // measuring copy plus `shrink-[999]` on the outer span) so the badge
  // actually competes with the name for row space, not just the measurement
  // effect. Until then the badge renders in full.
  const level = 2;

  if (isNative) {
    return withTooltip(
      <Badge
        data-testid="requirement-provenance-native"
        variant="outline"
        className={`text-xs gap-1 whitespace-nowrap text-muted-foreground cursor-default ${className ?? ""}`}
      >
        {t("nativeLabel")}
      </Badge>,
      t("nativeTooltip")
    );
  }

  if (!locked && !isDetached) {
    // Neither locked nor detached with integrationId set is not one of the
    // three defined states (e.g. a row not actually classified as a
    // requirement) — render nothing rather than mislabel it.
    return null;
  }

  const renderBadge = (asMenuTrigger: boolean) => (
    <Badge
      data-testid={testId}
      variant="outline"
      // min-w-0 + overflow-hidden let the caller shrink this badge (the tree
      // row gives it an overwhelming shrink weight) so the requirement's name
      // keeps its room. The Jira mark stays shrink-0 inside, so the badge
      // degrades toward icon-only rather than vanishing.
      // `bg-background` + `text-foreground` rather than the outline variant's
      // transparent fill: on a selected tree row the row's own accent
      // background showed through and the badge text lost contrast against
      // it. Painting the badge's own ground keeps it legible on selected,
      // hovered and plain rows alike.
      className={`text-xs gap-1 whitespace-nowrap group min-w-0 max-w-full overflow-hidden bg-background text-foreground ${
        asMenuTrigger || trackerUrl
          ? "cursor-pointer hover:bg-secondary/80"
          : "cursor-default"
      } ${className ?? ""}`}
      onClick={!asMenuTrigger && trackerUrl ? openInTracker : undefined}
    >
      {/* No lock glyph: the badge itself carries the state word ("Synced" vs
          "Detached"), which is the lock signal PROV-01 needs. A separate lock
          icon in front of it said the same thing twice. */}
      {/* Same shape a Jira-synced milestone's badge uses: the Jira mark, the
          provider name, and a hover-revealed link out to the item. The
          tracker key is deliberately NOT repeated here — both surfaces that
          render this badge already lead with the shared "KEY: Title" label,
          so echoing it printed the key twice on one line. This badge carries
          provenance and the way out to the tracker; the label carries
          identity. */}
      <span className="flex shrink-0 items-center">
        <JiraGlyph />
      </span>
      {level >= 1 && <span>{provider}</span>}
      {level >= 2 && <span>{`· ${label}`}</span>}
      {trackerUrl && (
        <ExternalLink
          data-testid="requirement-open-in-tracker"
          className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
    </Badge>
  );

  /**
   * Wraps a badge with the machinery the collapse needs: a sizing wrapper the
   * ResizeObserver watches, and an aria-hidden full-width copy that supplies
   * per-segment measurements.
   *
   * It also stops click and pointerdown from reaching the row. This badge is
   * rendered inside a tree row that selects on click, and Radix opens a
   * dropdown on pointerdown — without this the row's own handler won.
   */
  const collapsible = (badge: ReactElement) => (
    <span
      className={`relative flex min-w-0 items-center overflow-hidden ${className ?? ""}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {badge}
    </span>
  );

  // Detached rows have no further destructive action available — detach is
  // one-way in this release (re-attach isn't supported yet) — so a detached
  // badge never gets a menu, admin or not. It stays clickable straight to
  // the tracker when a safe URL is present.
  if (!locked) {
    return withTooltip(collapsible(renderBadge(false)), tooltipText);
  }

  // Client-side mirror of the detach route's authorization (25-05's
  // `authorizeProjectAdminForProject`) — a 403 from that route is the real
  // backstop. Non-admins get the plain locked badge, no menu.
  if (!isProjectAdmin) {
    return withTooltip(collapsible(renderBadge(false)), tooltipText);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsible(renderBadge(true))}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            disabled={!canOpenInTracker}
            className="gap-1"
            onClick={openInTracker}
            data-testid="requirement-provenance-menu-open"
          >
            <ExternalLink className="h-4 w-4" />
            {t("openInTracker", { provider: tCommon("fields.issueTracker") })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-1 text-destructive focus:text-destructive"
            onClick={() => setConfirmOpen(true)}
            data-testid="requirement-provenance-menu-detach"
          >
            <Unlink className="h-4 w-4" />
            {t("detach")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detachDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("detachDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="requirement-provenance-detach-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDetaching}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDetach()}
              data-testid="requirement-provenance-detach-confirm"
            >
              {t("detachConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

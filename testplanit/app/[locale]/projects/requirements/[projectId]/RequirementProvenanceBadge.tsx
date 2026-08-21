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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink, Lock, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "~/lib/navigation";
import { toast } from "sonner";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { isRequirementLocked } from "~/lib/services/linkedIssueUpsert";

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

  const label = locked ? t("syncedLabel") : t("detachedLabel");
  const tooltipText = locked ? t("syncedTooltip") : t("detachedTooltip");
  const testId = locked
    ? "requirement-provenance-locked"
    : "requirement-provenance-detached";

  const renderBadge = (asMenuTrigger: boolean) => (
    <Badge
      data-testid={testId}
      variant="outline"
      className={`text-xs gap-1 whitespace-nowrap group ${
        asMenuTrigger || trackerUrl
          ? "cursor-pointer hover:bg-secondary/80"
          : "cursor-default"
      } ${className ?? ""}`}
      onClick={!asMenuTrigger && trackerUrl ? openInTracker : undefined}
    >
      {locked && (
        <Lock
          data-testid="requirement-provenance-lock-icon"
          className="h-3 w-3 shrink-0"
        />
      )}
      <span>{label}</span>
      {requirement.externalKey && (
        <span className="opacity-80">{requirement.externalKey}</span>
      )}
    </Badge>
  );

  // Detached rows have no further destructive action available — detach is
  // one-way in this release (re-attach isn't supported yet) — so a detached
  // badge never gets a menu, admin or not. It stays clickable straight to
  // the tracker when a safe URL is present.
  if (!locked) {
    return withTooltip(renderBadge(false), tooltipText);
  }

  // Client-side mirror of the detach route's authorization (25-05's
  // `authorizeProjectAdminForProject`) — a 403 from that route is the real
  // backstop. Non-admins get the plain locked badge, no menu.
  if (!isProjectAdmin) {
    return withTooltip(renderBadge(false), tooltipText);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{renderBadge(true)}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
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

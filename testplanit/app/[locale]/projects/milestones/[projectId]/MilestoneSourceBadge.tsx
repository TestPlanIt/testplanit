"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { ExternalLink, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "~/lib/navigation";
import { siJira } from "simple-icons";
import { toast } from "sonner";

/**
 * A synced milestone's `externalUrl` is tracker-provided and written through
 * the raw db client, which bypasses the schema's `@url` validation — so only
 * treat http(s) URLs as linkable (never `javascript:` etc.) and open without
 * an opener reference to prevent reverse tab-nabbing.
 */
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

export interface MilestoneSourceBadgeMilestone {
  id: number;
  integrationId: number | null;
  externalKind: string | null;
  externalState: string | null;
  externalUrl: string | null;
  detachedAt?: Date | string | null;
  mergedToExternalId?: string | null;
}

interface MilestoneSourceBadgeProps {
  milestone: MilestoneSourceBadgeMilestone;
  className?: string;
}

function JiraGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 text-[#2684FF]"
      fill="currentColor"
    >
      <path d={siJira.path} />
    </svg>
  );
}

/**
 * "source removed in {provider}" / "merged into {target}" — the permanent,
 * non-dismissible badge shown once a synced milestone's upstream artifact
 * was deleted or merged away (D-06/D-08). Keyed on `externalState`, NOT on
 * `detachedAt` alone — a manual unlink also sets `detachedAt` but must
 * render NO badge at all (D-11), so this component is never reached for
 * that case (see the branch in `MilestoneSourceBadge` below).
 */
function RemovedOrMergedBadge({
  milestone,
  className,
}: MilestoneSourceBadgeProps) {
  const t = useTranslations("milestones");
  const provider = t("sync.providerJira");
  const isMerged = milestone.externalState === "merged";

  // Only look up the merge target when we actually need it — this query is
  // scoped to the rare "merged" case so it never fires for the common
  // synced/deleted/manual_unlink paths across a list of milestone cards.
  const { data: target } = useClientQueries(schema).milestones.useFindFirst(
    {
      where: {
        externalId: milestone.mergedToExternalId ?? undefined,
        integrationId: milestone.integrationId ?? undefined,
      },
      select: { id: true, name: true },
    },
    { enabled: Boolean(isMerged && milestone.mergedToExternalId) }
  );

  const label =
    isMerged && milestone.mergedToExternalId
      ? t("sync.mergedInto", {
          target: target?.name ?? milestone.mergedToExternalId,
        })
      : t("sync.sourceRemoved", { provider });

  const isLinkable = isMerged && target;

  return (
    <Badge
      data-testid="milestone-source-badge"
      variant="outline"
      role={isLinkable ? "link" : undefined}
      title={label}
      aria-label={label}
      className={`text-xs max-w-full gap-1 whitespace-nowrap text-muted-foreground cursor-default ${
        isLinkable ? "cursor-pointer hover:bg-secondary/40" : ""
      } ${className ?? ""}`}
      onClick={
        isLinkable
          ? (e) => {
              e.stopPropagation();
              window.location.assign(`../${target.id}`);
            }
          : undefined
      }
    >
      <span className="flex shrink-0 items-center">
        <JiraGlyph />
      </span>
      <span>{label}</span>
    </Badge>
  );
}

/**
 * The "Jira · Sprint · active" source badge shown on synced milestones
 * (LOCK-05). When a safe external URL is stored, the badge itself is the
 * open-in-tracker link and the external-link icon fades in on hover.
 *
 * Renders NOTHING for:
 * - local milestones (never synced)
 * - milestones manually unlinked (`externalState === "manual_unlink"`,
 *   D-11 — the user chose to detach, so no residual badge)
 *
 * Renders the permanent removed/merged badge (D-06/D-08) for milestones
 * whose upstream artifact was deleted or merged away
 * (`externalState === "deleted" | "merged"`).
 *
 * Otherwise (actively synced: `integrationId` set, `detachedAt` null)
 * renders the normal badge with a dropdown menu (D-09): "Open in
 * {provider}" and "Unlink from {provider}" (project-admin only — the
 * server authorizes the actual mutation; a 403 is the backstop).
 *
 * When the badge is squeezed by its flex row it collapses segment by
 * segment — state first, then kind, then the provider name — down to the
 * bare Jira glyph as its minimum width. An invisible full-width copy keeps
 * the wrapper requesting the expanded width, so the badge grows back as
 * soon as space returns; the full label stays available via aria-label.
 */
export function MilestoneSourceBadge({
  milestone,
  className,
}: MilestoneSourceBadgeProps) {
  const t = useTranslations("milestones");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  // Highest visible segment index: 0 = icon only, 1 = +provider,
  // 2 = +kind, 3 = +state.
  const [level, setLevel] = useState(3);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  // RESEARCH.md Pitfall 3: a converted (detached) milestone keeps
  // integrationId set, so the render guard must also admit detachedAt-set
  // rows instead of bailing out purely on integrationId == null.
  const isLocal =
    milestone.integrationId == null && milestone.detachedAt == null;

  const provider = t("sync.providerJira");
  const kind =
    milestone.externalKind === "RELEASE"
      ? t("import.kindRelease")
      : t("import.kindSprint");
  const state = milestone.externalState ?? "";
  const badgeLabel = t("sync.sourceBadge", { provider, kind, state });

  const safeExternalUrl =
    milestone.externalUrl && SAFE_EXTERNAL_URL_RE.test(milestone.externalUrl)
      ? milestone.externalUrl
      : null;

  const openInTracker = () => {
    if (!safeExternalUrl) return;
    window.open(safeExternalUrl, "_blank", "noopener,noreferrer");
  };

  const handleUnlink = async () => {
    setIsUnlinking(true);
    try {
      const res = await fetch(`/api/milestones/${milestone.id}/unlink`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Unlink failed with status ${res.status}`);
      }
      toast.success(t("sync.unlinkSuccess"));
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      console.error("Failed to unlink milestone:", err);
      toast.error(t("sync.unlinkError"));
    } finally {
      setIsUnlinking(false);
    }
  };

  useLayoutEffect(() => {
    if (isLocal) return;
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure || typeof ResizeObserver === "undefined") return;

    const compute = () => {
      const segs = Array.from(
        measure.querySelectorAll<HTMLElement>("[data-seg]")
      );
      const full = measure.getBoundingClientRect().width;
      if (full === 0 || segs.length === 0) return; // hidden or non-visual env
      const segWidths = segs.map((s) => s.getBoundingClientRect().width);
      const segTotal = segWidths.reduce((sum, w) => sum + w, 0);
      // Padding, inter-segment gaps, and the hover link-icon slot. Slightly
      // overestimates for collapsed levels (fewer gaps), which only makes
      // the collapse marginally eager — never an overflow.
      const chrome = full - segTotal;
      const available = wrap.getBoundingClientRect().width;
      let cum = chrome;
      let next = 0;
      for (let i = 0; i < segWidths.length; i++) {
        cum += segWidths[i];
        if (cum <= available + 0.5) next = i;
        else break;
      }
      setLevel(next);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [isLocal, provider, kind, state, safeExternalUrl]);

  if (isLocal) return null;

  // D-11: a manually-unlinked milestone is plain local — no badge, even
  // though detachedAt is set (same marker upstream removal uses). The
  // THREE-WAY externalState from convertMilestoneToLocal (Plan 03) is what
  // makes this distinguishable from "deleted"/"merged" below.
  if (milestone.externalState === "manual_unlink") return null;

  // D-06/D-08: upstream-initiated removal keeps a permanent, non-dismissible
  // badge — never a dropdown menu. This branch is keyed on externalState,
  // not detachedAt alone, since manual_unlink also sets detachedAt.
  if (
    milestone.detachedAt &&
    (milestone.externalState === "deleted" ||
      milestone.externalState === "merged")
  ) {
    return <RemovedOrMergedBadge milestone={milestone} className={className} />;
  }

  return (
    <span
      ref={wrapRef}
      className={`flex min-w-8 shrink flex-col items-start overflow-hidden ${className ?? ""}`}
    >
      {/* Invisible full copy: keeps the wrapper requesting the expanded
          width and provides per-segment measurements for the collapse. */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="invisible h-0 overflow-hidden"
      >
        <Badge variant="secondary" className="text-xs gap-1 whitespace-nowrap">
          <span data-seg className="flex items-center">
            <JiraGlyph />
          </span>
          <span data-seg>{provider}</span>
          <span data-seg>{`· ${kind}`}</span>
          {state && <span data-seg>{`· ${state}`}</span>}
          {safeExternalUrl && <ExternalLink className="h-3 w-3" />}
        </Badge>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Badge
            data-testid="milestone-source-badge"
            variant="secondary"
            role={safeExternalUrl ? "link" : undefined}
            title={safeExternalUrl ? t("sync.openInJira") : badgeLabel}
            aria-label={badgeLabel}
            className={`text-xs max-w-full gap-1 whitespace-nowrap group cursor-pointer hover:bg-secondary/80`}
          >
            <span className="flex shrink-0 items-center">
              <JiraGlyph />
            </span>
            {level >= 1 && <span>{provider}</span>}
            {level >= 2 && <span>{`· ${kind}`}</span>}
            {level >= 3 && state && <span>{`· ${state}`}</span>}
            {safeExternalUrl && (
              <ExternalLink
                data-testid="milestone-open-in-tracker"
                className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            )}
          </Badge>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            disabled={!safeExternalUrl}
            onClick={openInTracker}
            data-testid="milestone-source-menu-open"
          >
            <ExternalLink className="h-4 w-4" />
            {t("sync.openInJira")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmOpen(true)}
            data-testid="milestone-source-menu-unlink"
          >
            <Unlink className="h-4 w-4" />
            {t("sync.unlinkMenuItem", { provider })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sync.unlinkConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sync.unlinkConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="milestone-source-unlink-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isUnlinking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleUnlink()}
              data-testid="milestone-source-unlink-confirm"
            >
              {t("sync.unlinkConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

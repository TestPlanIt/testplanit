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
import { useProjectPermissions } from "~/hooks/useProjectPermissions";

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

/**
 * A project's active `IntegrationProject` mapping — the external Jira project
 * ("space") this integration is linked to, carrying both its full name and
 * short key. Fetched ONCE per list/detail by the parent (keyed by the
 * milestones' integration ids) rather than per badge, since the milestones
 * list would otherwise fire one lookup per row.
 */
export interface MilestoneIntegrationProject {
  externalProjectKey: string;
  externalProjectName: string;
  projectIntegration?: { integrationId: number | null } | null;
}

interface MilestoneSourceBadgeProps {
  milestone: MilestoneSourceBadgeMilestone;
  projectId?: number;
  /**
   * Active IntegrationProject mappings for the surrounding milestones'
   * integration(s). Used to render the Jira project ("space") segment. When
   * absent (or when the project can't be resolved unambiguously) the badge
   * renders exactly as before, with no project segment.
   */
  integrationProjects?: MilestoneIntegrationProject[] | null;
  className?: string;
}

/**
 * Jira embeds the project key in a version's URL
 * (`.../projects/{KEY}/versions/{id}`) but NOT in a sprint's
 * (`.../RapidBoard.jspa?rapidView=...&sprint=...`), so this resolves a key
 * only for RELEASE-kind milestones; sprints fall through to the
 * single-mapping case in {@link resolveMilestoneProjectSpace}.
 */
function projectKeyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/projects\/([^/?#]+)\/versions\//i);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Picks the Jira project ("space") a synced milestone belongs to from the
 * project's active IntegrationProject mappings, returning its full `name` and
 * `short` key. A single TPI project can map to MULTIPLE external projects on
 * one integration (e.g. sprints on a shared board) and the milestone row does
 * not persist which one it came from, so we: (1) trust the key embedded in a
 * version URL when present; else (2) use the sole mapping when unambiguous;
 * else (3) return null rather than display a possibly-wrong project.
 */
export function resolveMilestoneProjectSpace(
  milestone: MilestoneSourceBadgeMilestone,
  integrationProjects?: MilestoneIntegrationProject[] | null
): { name: string; short: string } | null {
  if (!integrationProjects || milestone.integrationId == null) return null;
  const mappings = integrationProjects.filter(
    (ip) => ip.projectIntegration?.integrationId === milestone.integrationId
  );
  if (mappings.length === 0) return null;

  const urlKey = projectKeyFromUrl(milestone.externalUrl);
  const chosen =
    (urlKey &&
      mappings.find(
        (m) => m.externalProjectKey.toUpperCase() === urlKey.toUpperCase()
      )) ||
    (mappings.length === 1 ? mappings[0] : null);
  if (!chosen) return null;

  const name = chosen.externalProjectName?.trim() || chosen.externalProjectKey;
  const short = chosen.externalProjectKey?.trim() || name;
  return { name, short };
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
  const router = useRouter();
  const provider = t("sync.providerJira");
  const isMerged = milestone.externalState === "merged";

  // Only look up the merge target when we actually need it — this query is
  // scoped to the rare "merged" case so it never fires for the common
  // synced/deleted/manual_unlink paths across a list of milestone cards.
  // `projectId` is selected so the click below can navigate ABSOLUTELY —
  // a relative `../${id}` resolves against whichever page the badge happens
  // to render on (list vs detail) and lands on the wrong route for both.
  const { data: target } = useClientQueries(schema).milestones.useFindFirst(
    {
      where: {
        externalId: milestone.mergedToExternalId ?? undefined,
        integrationId: milestone.integrationId ?? undefined,
      },
      select: { id: true, name: true, projectId: true },
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
              // Absolute path via the i18n router (~/lib/navigation) — the
              // badge renders on both the milestones LIST and the milestone
              // DETAIL page, so any relative navigation is wrong on at
              // least one of them.
              router.push(
                `/projects/milestones/${target.projectId}/${target.id}`
              );
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
 * {provider}" and "Unlink from {provider}". The unlink item is
 * project-admin only client-side (mirrors the server authorization on the
 * unlink route — a 403 is the backstop). Non-admins see a plain
 * open-in-tracker badge instead of a single-item menu.
 *
 * When linked to an external project ("space"), a trailing project segment
 * is appended after state. It renders the project's FULL name when there's
 * room, swaps to the SHORT key as space tightens, then drops entirely —
 * i.e. it is the first segment to collapse.
 *
 * When the badge is squeezed by its flex row it collapses segment by
 * segment — project (full → short → gone) first, then state, then kind,
 * then the provider name — down to the bare Jira glyph as its minimum
 * width. An invisible full-width copy keeps the wrapper requesting the
 * expanded width, so the badge grows back as soon as space returns; the
 * full label stays available via aria-label.
 */
export function MilestoneSourceBadge({
  milestone,
  projectId,
  integrationProjects,
  className,
}: MilestoneSourceBadgeProps) {
  const t = useTranslations("milestones");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const projectSpace = resolveMilestoneProjectSpace(
    milestone,
    integrationProjects
  );
  // Primitive copies for the layout effect's dependency array — the resolver
  // returns a fresh object each render, so depending on the object identity
  // would re-run (and re-measure) on every render.
  const projectName = projectSpace?.name ?? null;
  const projectShort = projectSpace?.short ?? null;
  // Highest visible segment index: 0 = icon only, 1 = +provider, 2 = +kind,
  // 3 = +state, 4 = +project (short key), 5 = project (full name). Levels
  // 4/5 only apply when a project space is resolved. Starts fully expanded
  // and the layout effect collapses to fit before paint.
  const [level, setLevel] = useState(projectSpace ? 5 : 3);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const { isProjectAdmin } = useProjectPermissions(projectId ?? 0);

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
  // Append the project's full name (locale-neutral `·` separator, matching
  // the sourceBadge template) so the accessible label stays complete
  // regardless of how far the visible badge has collapsed.
  const badgeLabel =
    t("sync.sourceBadge", { provider, kind, state }) +
    (projectSpace ? ` · ${projectSpace.name}` : "");

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
      const width = (name: string) =>
        measure
          .querySelector<HTMLElement>(`[data-seg="${name}"]`)
          ?.getBoundingClientRect().width ?? 0;
      const full = measure.getBoundingClientRect().width;
      if (full === 0) return; // hidden or non-visual env

      const iconW = width("icon");
      const providerW = width("provider");
      const kindW = width("kind");
      const stateW = width("state");
      const shortW = width("project-short");
      const fullW = width("project-full");

      // Everything the visible badge spends that isn't a measured segment:
      // padding, inter-segment gaps, and the hover link-icon slot. The hidden
      // copy carries BOTH project variants, so this over-counts by ~one gap —
      // which only makes the collapse marginally eager, never an overflow.
      const chrome =
        full - (iconW + providerW + kindW + stateW + shortW + fullW);
      const available = wrap.getBoundingClientRect().width;

      // Incremental width unlocked at each level; index i => level i+1.
      // 1:+provider 2:+kind 3:+state 4:+project(short key)
      // 5:project(full name) — the last step is the short→full delta.
      const steps = [providerW, kindW, stateW];
      if (projectName) {
        steps.push(shortW);
        steps.push(fullW - shortW);
      }
      let cum = chrome + iconW;
      let next = 0;
      for (let i = 0; i < steps.length; i++) {
        cum += steps[i];
        if (cum <= available + 0.5) next = i + 1;
        else break;
      }
      setLevel(next);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [
    isLocal,
    provider,
    kind,
    state,
    safeExternalUrl,
    projectName,
    projectShort,
  ]);

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

  const badgeSegments = (
    <>
      <span className="flex shrink-0 items-center">
        <JiraGlyph />
      </span>
      {level >= 1 && <span>{provider}</span>}
      {level >= 2 && <span>{`· ${kind}`}</span>}
      {level >= 3 && state && <span>{`· ${state}`}</span>}
      {projectSpace && level >= 4 && (
        <span data-testid="milestone-source-project">
          {`· ${level >= 5 ? projectSpace.name : projectSpace.short}`}
        </span>
      )}
      {safeExternalUrl && (
        <ExternalLink
          data-testid="milestone-open-in-tracker"
          className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}
    </>
  );

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
        <Badge variant="outline" className="text-xs gap-1 whitespace-nowrap">
          <span data-seg="icon" className="flex items-center">
            <JiraGlyph />
          </span>
          <span data-seg="provider">{provider}</span>
          <span data-seg="kind">{`· ${kind}`}</span>
          {state && <span data-seg="state">{`· ${state}`}</span>}
          {projectSpace && (
            <span data-seg="project-short">{`· ${projectSpace.short}`}</span>
          )}
          {projectSpace && (
            <span data-seg="project-full">{`· ${projectSpace.name}`}</span>
          )}
          {safeExternalUrl && <ExternalLink className="h-3 w-3" />}
        </Badge>
      </span>
      {isProjectAdmin ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Badge
              data-testid="milestone-source-badge"
              variant="outline"
              role={safeExternalUrl ? "link" : undefined}
              title={safeExternalUrl ? t("sync.openInJira") : badgeLabel}
              aria-label={badgeLabel}
              className={`text-xs max-w-full gap-1 whitespace-nowrap group cursor-pointer hover:bg-secondary/80`}
            >
              {badgeSegments}
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              disabled={!safeExternalUrl}
              className="gap-1"
              onClick={openInTracker}
              data-testid="milestone-source-menu-open"
            >
              <ExternalLink className="h-4 w-4" />
              {t("sync.openInJira")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-1 text-destructive focus:text-destructive"
              onClick={() => setConfirmOpen(true)}
              data-testid="milestone-source-menu-unlink"
            >
              <Unlink className="h-4 w-4" />
              {t("sync.unlinkMenuItem", { provider })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Badge
          data-testid="milestone-source-badge"
          variant="outline"
          role={safeExternalUrl ? "link" : undefined}
          title={safeExternalUrl ? t("sync.openInJira") : badgeLabel}
          aria-label={badgeLabel}
          className={`text-xs max-w-full gap-1 whitespace-nowrap group ${
            safeExternalUrl
              ? "cursor-pointer hover:bg-secondary/80"
              : "cursor-default"
          }`}
          onClick={safeExternalUrl ? openInTracker : undefined}
        >
          {badgeSegments}
        </Badge>
      )}
      {isProjectAdmin && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("sync.unlinkConfirmTitle")}
              </AlertDialogTitle>
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
      )}
    </span>
  );
}

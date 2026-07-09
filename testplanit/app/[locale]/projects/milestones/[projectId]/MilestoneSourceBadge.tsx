"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { siJira } from "simple-icons";

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
 * The "Jira · Sprint · active" source badge shown on synced milestones
 * (LOCK-05). When a safe external URL is stored, the badge itself is the
 * open-in-tracker link and the external-link icon fades in on hover.
 * Renders nothing for local milestones.
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
  const wrapRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  // Highest visible segment index: 0 = icon only, 1 = +provider,
  // 2 = +kind, 3 = +state.
  const [level, setLevel] = useState(3);

  const isLocal = milestone.integrationId == null;

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
      <Badge
        data-testid="milestone-source-badge"
        variant="secondary"
        role={safeExternalUrl ? "link" : undefined}
        title={safeExternalUrl ? t("sync.openInJira") : badgeLabel}
        aria-label={badgeLabel}
        className={`text-xs max-w-full gap-1 whitespace-nowrap ${
          safeExternalUrl ? "group cursor-pointer hover:bg-secondary/80" : ""
        }`}
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
    </span>
  );
}

"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, PackageOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { MemberOverflowResponse } from "~/app/api/milestones/[milestoneId]/members/overflow/route";
import { useMilestoneLiveStream } from "~/hooks/useMilestoneLiveStream";

interface MemberIssuesOverflowPanelProps {
  milestoneId: number;
  /** Called after a successful "Import & link" so the caller can refetch
   * member rows/coverage. */
  onImported?: () => void;
}

/**
 * Live overflow panel for the Member Issues section (MLINK-02, Blocker fix).
 * Mirrors `ImportMilestonesDialog`'s live-preview shape: it ALWAYS fetches
 * the 18-05 overflow route and self-gates its render on a non-empty
 * `members` array from the response envelope — there is NO dependency on
 * any table-surfaced `reachedCap` signal. A non-empty live diff is ground
 * truth for "in Jira but not linked locally" regardless of cause (a true
 * cap hit, a sync race, or ordinary membership drift).
 *
 * "Import & link" never writes MilestoneIssue rows directly from this
 * client-fetched list (T-18-07-01) — it POSTs to the same route, which
 * re-runs the server-side reconciliation path
 * (MilestoneSyncService.performMilestoneRefresh / _reconcileMembership)
 * against the live adapter.
 */
export function MemberIssuesOverflowPanel({
  milestoneId,
  onImported,
}: MemberIssuesOverflowPanelProps) {
  const t = useTranslations("milestones.members");
  const queryClient = useQueryClient();
  const [isImporting, setIsImporting] = useState(false);

  const { data, isLoading, refetch } = useQuery<MemberOverflowResponse>({
    queryKey: ["milestoneMemberOverflow", milestoneId],
    queryFn: async () => {
      const response = await fetch(
        `/api/milestones/${milestoneId}/members/overflow`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch member overflow");
      }
      return response.json();
    },
    staleTime: 30000,
  });

  // Import & link queues a worker job — the links land seconds after the
  // POST returns, so a one-shot refetch would race it. Rather than a
  // time-boxed poll (retired, D-16), subscribe to this milestone's SSE
  // stream and refetch when a milestone.membership_changed wake-up lands
  // (import completion and conversion both emit this — RESEARCH.md Pitfall
  // 5). Mirrors useIssueUpdateStream's coalesced-invalidation shape rather
  // than a bespoke debounce: every wake-up just re-marks this one query
  // stale via invalidateQueries, letting React Query's own de-dup collapse
  // a wake-up burst into a single in-flight refetch.
  useMilestoneLiveStream({
    milestoneId,
    onWakeUp: useCallback(
      (event) => {
        if (event.event !== "milestone.membership_changed") return;
        void queryClient.invalidateQueries({
          queryKey: ["milestoneMemberOverflow", milestoneId],
        });
      },
      [queryClient, milestoneId]
    ),
  });

  // Self-gated on a non-empty `members` array — never on a table-surfaced
  // reachedCap signal (Blocker fix).
  if (isLoading || !data || data.members.length === 0) {
    return null;
  }

  const { members, linkedCount, cap, overflowTotal } = data;
  const isTrueCapHit = linkedCount >= cap && overflowTotal > 0;
  const isDrift = !isTrueCapHit && overflowTotal > 0;

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const response = await fetch(
        `/api/milestones/${milestoneId}/members/overflow`,
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || t("overflowImportError"));
      }
      toast.success(t("overflowImportSuccess"));
      // One immediate refetch in case the POST's own writes already landed
      // synchronously; the milestone.membership_changed wake-up (subscribed
      // above) catches the worker-completed links that land moments later —
      // no time-boxed poll needed (D-16).
      void refetch();
      onImported?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("overflowImportError")
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Card
      data-testid="member-issues-overflow-panel"
      className="border-amber-300 dark:border-amber-800"
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            {t("overflowTitle")}
          </CardTitle>
          {isTrueCapHit ? (
            <Badge
              variant="outline"
              className="border-warning bg-warning/15 text-foreground"
              data-testid="member-issues-overflow-capped-badge"
            >
              {t("overflowCapped", { cap, overflowTotal })}
            </Badge>
          ) : isDrift ? (
            <Badge
              variant="outline"
              className="text-muted-foreground"
              data-testid="member-issues-overflow-drift-badge"
            >
              {t("overflowMoreAvailable", { overflowTotal })}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant="default" className="border-amber-300 dark:border-amber-800">
          <PackageOpen className="h-4 w-4" />
          <AlertDescription>{t("overflowDescription")}</AlertDescription>
        </Alert>

        <ScrollArea className="max-h-[280px] rounded-md border">
          <div className="p-3 space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                data-testid="overflow-member-row"
                className="flex items-center justify-between gap-2 rounded-md border p-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {member.key && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {"["}
                        {member.key}
                        {"]"}
                      </span>
                    )}
                    <span className="text-sm font-medium truncate">
                      {member.title}
                    </span>
                  </div>
                  {member.status && (
                    <span className="text-xs text-muted-foreground">
                      {member.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => void handleImport()}
            disabled={isImporting}
            data-testid="member-issues-overflow-import-button"
          >
            {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("overflowImportAction")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

/**
 * Edit control for configuration-group membership.
 *
 * Test runs (and sessions) that cover the same logical work across different
 * configurations share a `configurationGroupId`. Groups have no name and no
 * identity a user could pick from, so the interaction is modelled the way
 * people describe it: "link this run to that run" — you pick a PEER, and this
 * record inherits the peer's group.
 *
 * Members are flat peers: joining is symmetric and there is no original. Two
 * members may deliberately share one configuration, so members are labelled
 * through `buildConfigurationGroupMemberLabels`, which falls back to the
 * member's own name whenever the configuration alone can't identify it.
 *
 * The control never writes on its own. It reports the intended field values
 * and the caller decides when to persist them — inside a form submit on the
 * edit form, or immediately when the record is read-only for other reasons
 * (a completed or composition-locked run may still be re-grouped).
 */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import { HelpPopover } from "@/components/ui/help-popover";
import { Link2, Link2Off } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import {
  buildConfigurationGroupMemberLabels,
  buildConfigurationGroupWhere,
  isConfigurationGroupQueryEnabled,
} from "~/lib/configurationGroupSwitcher";
import { planJoin } from "~/lib/services/configurationGroups";
import { Link } from "~/lib/navigation";
import { schema } from "~/zenstack/schema";

export type ConfigurationGroupLinkModel = "testRuns" | "sessions";

/** The field writes a pick (or an unlink) implies. */
export interface ConfigurationGroupLinkChange {
  /** Value for THIS record's `configurationGroupId`. */
  groupId: string | null;
  /**
   * Peer that must be stamped with the same `groupId`. Non-null only when the
   * picked peer had no group yet and a fresh uuid was minted for both.
   */
  stampTargetId: number | null;
}

type CandidateOption = {
  id: number;
  name: string;
  projectId: number;
  configurationGroupId: string | null;
  configuration: { id: number; name: string } | null;
  /** How many records are already in this candidate's group. Picking it links
   *  you to all of them, not just the one you chose, so the count is shown in
   *  the option itself — after the fact is too late to be useful. */
  groupSize?: number;
};

interface ConfigurationGroupLinkFieldProps {
  model: ConfigurationGroupLinkModel;
  /** The run/session being edited. */
  recordId: number;
  projectId: number;
  /** Group id the form currently holds (may be an unsaved pick). */
  value: string | null;
  /** Group id persisted on the record, so an unsaved pick can be flagged. */
  savedValue: string | null;
  onChange: (change: ConfigurationGroupLinkChange) => void;
  /** False renders the current state read-only. */
  editable: boolean;
  disabled?: boolean;
}

const RPC_MODEL_PATH: Record<ConfigurationGroupLinkModel, string> = {
  testRuns: "TestRuns",
  sessions: "Sessions",
};

const ROUTE_SEGMENT: Record<ConfigurationGroupLinkModel, string> = {
  testRuns: "runs",
  sessions: "sessions",
};

export function ConfigurationGroupLinkField({
  model,
  recordId,
  projectId,
  value,
  savedValue,
  onChange,
  editable,
  disabled = false,
}: ConfigurationGroupLinkFieldProps) {
  const t = useTranslations("common");
  const isRuns = model === "testRuns";
  const helpKey = isRuns
    ? "testRun.configurationGroup"
    : "session.configurationGroup";

  // A peer picked in this session that isn't in the member query yet — either
  // because the group id was just minted, or because the query hasn't caught
  // up. Merged into the member list so the UI reflects the pick immediately.
  const [pendingPeer, setPendingPeer] = useState<CandidateOption | null>(null);

  // Staged membership is only ever shown where it can also be saved. Outside
  // edit mode the pages keep rendering this field, and a caller that stages a
  // pick and then leaves without saving would otherwise have the abandoned
  // group listed as though it were this record's real membership — the
  // "not saved yet" notice lives in the editable branch and cannot warn there.
  const displayedGroupId = editable ? value : savedValue;
  const scope = { configurationGroupId: displayedGroupId, projectId };
  const memberArgs = {
    where: buildConfigurationGroupWhere(scope),
    select: {
      id: true,
      name: true,
      configuration: { select: { id: true, name: true } },
    },
    // Members may share a configuration, so break ties on id for a stable order.
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  };
  const queries = useClientQueries(schema);
  const runMembers = queries.testRuns.useFindMany(memberArgs, {
    enabled: isRuns && isConfigurationGroupQueryEnabled(scope),
  });
  const sessionMembers = queries.sessions.useFindMany(memberArgs, {
    enabled: !isRuns && isConfigurationGroupQueryEnabled(scope),
  });

  /** Every live member of the group except this record. */
  const peers = useMemo(() => {
    const rows = ((isRuns ? runMembers.data : sessionMembers.data) ??
      []) as Array<{
      id: number;
      name: string;
      configuration: { id: number; name: string } | null;
    }>;
    const list = rows.filter((row) => row.id !== recordId);
    if (
      editable &&
      displayedGroupId &&
      pendingPeer &&
      pendingPeer.id !== recordId &&
      !list.some((row) => row.id === pendingPeer.id)
    ) {
      list.push({
        id: pendingPeer.id,
        name: pendingPeer.name,
        configuration: pendingPeer.configuration,
      });
    }
    return list;
  }, [
    isRuns,
    runMembers.data,
    sessionMembers.data,
    recordId,
    editable,
    displayedGroupId,
    pendingPeer,
  ]);

  const peerLabels = useMemo(
    () =>
      buildConfigurationGroupMemberLabels(peers, {
        noConfiguration: t("labels.noConfiguration"),
        withMemberName: (values) => t("labels.configurationWithName", values),
      }),
    [peers, t]
  );

  const excludedIds = useMemo(
    () => [recordId, ...peers.map((peer) => peer.id)],
    [recordId, peers]
  );

  const fetchCandidates = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const where = {
        projectId,
        isDeleted: false,
        id: { notIn: excludedIds },
        ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
      };
      const params = {
        where,
        select: {
          id: true,
          name: true,
          projectId: true,
          configurationGroupId: true,
          configuration: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" as const }],
        skip: page * pageSize,
        take: pageSize,
      };
      const path = RPC_MODEL_PATH[model];
      const response = await fetch(
        `/api/model/${path}/findMany?q=${encodeURIComponent(JSON.stringify(params))}`
      );
      if (!response.ok) {
        return { results: [] as CandidateOption[], total: 0 };
      }
      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as CandidateOption[])
        : [];

      const countResponse = await fetch(
        `/api/model/${path}/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
      );
      let total = results.length;
      if (countResponse.ok) {
        const countPayload = await countResponse.json();
        if (typeof countPayload?.data === "number") total = countPayload.data;
      }
      // A candidate already in a group brings its whole group with it. Resolve
      // the sizes for this page so the option can say so before it is picked.
      const groupIds = Array.from(
        new Set(
          results
            .map((r) => r.configurationGroupId)
            .filter((id): id is string => !!id)
        )
      );
      if (groupIds.length > 0) {
        const sizeResponse = await fetch(
          `/api/model/${path}/findMany?q=${encodeURIComponent(
            JSON.stringify({
              where: {
                projectId,
                isDeleted: false,
                configurationGroupId: { in: groupIds },
              },
              select: { configurationGroupId: true },
            })
          )}`
        );
        if (sizeResponse.ok) {
          const sizePayload = await sizeResponse.json();
          const rows = Array.isArray(sizePayload?.data) ? sizePayload.data : [];
          const sizes = new Map<string, number>();
          for (const row of rows as Array<{ configurationGroupId: string }>) {
            sizes.set(
              row.configurationGroupId,
              (sizes.get(row.configurationGroupId) ?? 0) + 1
            );
          }
          for (const r of results) {
            if (r.configurationGroupId) {
              r.groupSize = sizes.get(r.configurationGroupId);
            }
          }
        }
      }

      return { results, total };
    },
    [model, projectId, excludedIds]
  );

  const handlePick = useCallback(
    (option: CandidateOption | null) => {
      if (!option) return;
      // The same planner the server uses: a peer with no group means a fresh
      // uuid stamped on BOTH records; a peer already in a group means this
      // record simply adopts it.
      const plan = planJoin(
        { id: recordId, projectId, configurationGroupId: value },
        {
          id: option.id,
          projectId: option.projectId ?? projectId,
          configurationGroupId: option.configurationGroupId ?? null,
        },
        { model }
      );
      if (plan.noop) return;
      setPendingPeer(option);
      onChange({
        groupId: plan.groupId,
        stampTargetId:
          plan.writes.find((write) => write.id !== recordId)?.id ?? null,
      });
    },
    [model, onChange, projectId, recordId, value]
  );

  const handleUnlink = useCallback(() => {
    setPendingPeer(null);
    onChange({ groupId: null, stampTargetId: null });
  }, [onChange]);

  const linked = !!displayedGroupId && peers.length > 0;
  const hasUnsavedChange = value !== savedValue;

  return (
    <div className="space-y-2" data-testid="configuration-group-link-field">
      {/* A plain heading, not a `FormLabel`: this block renders outside the
          form on read-only records, where there is no react-hook-form context
          to read, and it labels a group of controls rather than one input. */}
      <div className="flex items-center gap-1">
        <p className="text-base font-bold">{t("configurationGroup.title")}</p>
        <HelpPopover helpKey={helpKey} />
      </div>
      {linked ? (
        <ul className="space-y-1" data-testid="configuration-group-members">
          {peers.map((peer) => (
            <li
              key={peer.id}
              className="flex min-w-0 items-start gap-2 text-sm"
              data-testid={`configuration-group-member-${peer.id}`}
            >
              <Link
                href={`/projects/${ROUTE_SEGMENT[model]}/${projectId}/${peer.id}`}
                className="truncate hover:underline"
              >
                {peer.name}
              </Link>
              <ConfigurationNameDisplay
                name={peerLabels.get(peer.id) ?? peer.name}
                className="text-muted-foreground min-w-0"
                truncate
              />
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="text-muted-foreground text-sm"
          data-testid="configuration-group-empty"
        >
          {isRuns
            ? t("configurationGroup.notLinkedRun")
            : t("configurationGroup.notLinkedSession")}
        </p>
      )}
      {editable && (
        <div className="space-y-2">
          {/* The consequence of picking, stated where the picking happens:
              a group has no owner, so joining one run joins all of them.
              Only rendered with the actions — it is advice about an action
              the reader cannot take outside edit mode. */}
          <p
            className="text-muted-foreground text-xs"
            data-testid="configuration-group-link-hint"
          >
            {isRuns
              ? t("configurationGroup.linkHintRun")
              : t("configurationGroup.linkHintSession")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <AsyncCombobox<CandidateOption>
              value={null}
              onValueChange={handlePick}
              fetchOptions={fetchCandidates}
              showTotal
              getOptionValue={(option) => option.id}
              disabled={disabled}
              minDropdownWidth={320}
              className="w-full sm:w-auto"
              placeholder={
                isRuns
                  ? t("searchRuns", { count: 0 })
                  : t("searchSessions", { count: 0 })
              }
              triggerLabel={
                <span className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0" />
                  {linked
                    ? isRuns
                      ? t("configurationGroup.changeRun")
                      : t("configurationGroup.changeSession")
                    : isRuns
                      ? t("configurationGroup.linkRun")
                      : t("configurationGroup.linkSession")}
                </span>
              }
              renderOption={(option) => (
                // `flex-1` so this fills the option row: the option is a flex
                // container, and without it this box sizes to its content, so
                // the badge's right edge lands mid-option instead of flush.
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{option.name}</span>
                  {/* Configuration on the left, group size pinned right: the
                      badge is what changes the outcome of picking, so it is
                      never the part that truncates. */}
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    <ConfigurationNameDisplay
                      name={option.configuration?.name}
                      fallback={t("labels.noConfiguration")}
                      className="text-muted-foreground min-w-0 text-xs"
                      truncate
                    />
                    {option.groupSize && option.groupSize > 1 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-xs font-normal"
                            data-testid={`configuration-group-candidate-size-${option.id}`}
                          >
                            {isRuns
                              ? t("configurationGroup.candidateInGroupRun", {
                                  count: option.groupSize,
                                })
                              : t(
                                  "configurationGroup.candidateInGroupSession",
                                  {
                                    count: option.groupSize,
                                  }
                                )}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isRuns
                            ? t(
                                "configurationGroup.candidateInGroupTooltipRun",
                                {
                                  count: option.groupSize,
                                }
                              )
                            : t(
                                "configurationGroup.candidateInGroupTooltipSession",
                                { count: option.groupSize }
                              )}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
              )}
              renderTrigger={({ defaultContent }) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  // AsyncCombobox only forwards `disabled` to intrinsic
                  // elements, so a component trigger has to set it itself.
                  disabled={disabled}
                  className="justify-start text-start"
                  data-testid="configuration-group-link-picker"
                >
                  {defaultContent}
                </Button>
              )}
            />
            {!!value && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUnlink}
                disabled={disabled}
                data-testid="configuration-group-unlink"
              >
                <Link2Off className="h-4 w-4 shrink-0" />
                {t("configurationGroup.unlink")}
              </Button>
            )}
          </div>
          {hasUnsavedChange && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="configuration-group-pending"
            >
              {t("configurationGroup.pending")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default ConfigurationGroupLinkField;

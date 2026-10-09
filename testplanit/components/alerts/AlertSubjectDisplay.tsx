"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useMemo } from "react";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { subjectPath } from "~/lib/alerts/subjectPath";
import { AlertSubjectType } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

interface SubjectRef {
  subjectType: AlertSubjectType;
  subjectId: number;
}

/** What the standard name components need beyond the id and name an event stores. */
export interface AlertSubjectMeta {
  cases: Map<
    number,
    { automated: boolean; source: string; isDeleted: boolean }
  >;
  runs: Map<number, { isDeleted: boolean }>;
  milestones: Map<number, { iconName?: string; isDeleted: boolean }>;
}

const EMPTY_META: AlertSubjectMeta = {
  cases: new Map(),
  runs: new Map(),
  milestones: new Map(),
};

/**
 * Looks up the type icon, automation flag and deleted state of the subjects
 * in a set of events, one query per kind, so each renders through the same
 * component it uses everywhere else.
 */
export function useAlertSubjectMeta(events: SubjectRef[]): AlertSubjectMeta {
  const client = useClientQueries(schema);
  const ids = useMemo(() => {
    const collect = (type: AlertSubjectType) => [
      ...new Set(
        events.filter((e) => e.subjectType === type).map((e) => e.subjectId)
      ),
    ];
    return {
      cases: collect(AlertSubjectType.CASE),
      runs: collect(AlertSubjectType.RUN),
      milestones: collect(AlertSubjectType.MILESTONE),
    };
  }, [events]);

  const { data: cases } = client.repositoryCases.useFindMany(
    {
      where: { id: { in: ids.cases } },
      select: { id: true, automated: true, source: true, isDeleted: true },
    },
    { enabled: ids.cases.length > 0 }
  );
  const { data: runs } = client.testRuns.useFindMany(
    {
      where: { id: { in: ids.runs } },
      select: { id: true, isDeleted: true },
    },
    { enabled: ids.runs.length > 0 }
  );
  const { data: milestones } = client.milestones.useFindMany(
    {
      where: { id: { in: ids.milestones } },
      select: {
        id: true,
        isDeleted: true,
        milestoneType: { select: { icon: { select: { name: true } } } },
      },
    },
    { enabled: ids.milestones.length > 0 }
  );

  return useMemo(() => {
    if (!cases && !runs && !milestones) return EMPTY_META;
    return {
      cases: new Map(
        (cases ?? []).map((c) => [
          c.id,
          { automated: c.automated, source: c.source, isDeleted: c.isDeleted },
        ])
      ),
      runs: new Map(
        (runs ?? []).map((r) => [r.id, { isDeleted: r.isDeleted }])
      ),
      milestones: new Map(
        (milestones ?? []).map((m) => [
          m.id,
          {
            iconName: m.milestoneType?.icon?.name ?? undefined,
            isDeleted: m.isDeleted,
          },
        ])
      ),
    };
  }, [cases, runs, milestones]);
}

/**
 * A fired subject rendered with its kind's standard name component: the
 * case display, the run name, or the milestone name, each linked to the
 * subject in its project.
 */
export function AlertSubjectDisplay({
  subjectType,
  subjectId,
  subjectName,
  projectId,
  testRunId,
  meta,
}: SubjectRef & {
  subjectName: string;
  projectId: number;
  testRunId?: number | null;
  meta: AlertSubjectMeta;
}) {
  const href = subjectPath(subjectType, projectId, subjectId, testRunId);
  switch (subjectType) {
    case AlertSubjectType.CASE: {
      const info = meta.cases.get(subjectId);
      return (
        <CaseDisplay
          id={subjectId}
          name={subjectName}
          automated={info?.automated}
          source={info?.source}
          isDeleted={info?.isDeleted}
          link={href}
          size="medium"
          maxLines={1}
        />
      );
    }
    case AlertSubjectType.RUN:
      return (
        <TestRunNameDisplay
          testRun={{
            id: subjectId,
            name: subjectName,
            isDeleted: meta.runs.get(subjectId)?.isDeleted,
          }}
          projectId={projectId}
          className="truncate"
        />
      );
    case AlertSubjectType.MILESTONE: {
      const info = meta.milestones.get(subjectId);
      return (
        <MilestoneIconAndName
          milestone={{
            id: subjectId,
            name: subjectName,
            milestoneType: {
              icon: info?.iconName ? { name: info.iconName } : null,
            },
          }}
          projectId={projectId}
          size="sm"
        />
      );
    }
    default:
      return <span>{subjectName}</span>;
  }
}

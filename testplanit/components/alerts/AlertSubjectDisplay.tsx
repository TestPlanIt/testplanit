"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useMemo } from "react";
import { Sparkles, Webhook } from "lucide-react";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { ProjectIcon } from "@/components/ProjectIcon";
import { SessionNameDisplay } from "@/components/SessionNameDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { Link } from "~/lib/navigation";
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
  sessions: Map<number, { isDeleted: boolean }>;
  projects: Map<number, { iconUrl: string | null }>;
}

const EMPTY_META: AlertSubjectMeta = {
  cases: new Map(),
  runs: new Map(),
  milestones: new Map(),
  sessions: new Map(),
  projects: new Map(),
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
      sessions: collect(AlertSubjectType.SESSION),
      projects: collect(AlertSubjectType.PROJECT),
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

  const { data: sessions } = client.sessions.useFindMany(
    {
      where: { id: { in: ids.sessions } },
      select: { id: true, isDeleted: true },
    },
    { enabled: ids.sessions.length > 0 }
  );
  const { data: projects } = client.projects.useFindMany(
    {
      where: { id: { in: ids.projects } },
      select: { id: true, iconUrl: true },
    },
    { enabled: ids.projects.length > 0 }
  );

  return useMemo(() => {
    if (!cases && !runs && !milestones && !sessions && !projects) {
      return EMPTY_META;
    }
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
      sessions: new Map(
        (sessions ?? []).map((x) => [x.id, { isDeleted: x.isDeleted }])
      ),
      projects: new Map(
        (projects ?? []).map((x) => [x.id, { iconUrl: x.iconUrl ?? null }])
      ),
    };
  }, [cases, runs, milestones, sessions, projects]);
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
  /** Null for a system alert's subject. */
  projectId: number | null;
  testRunId?: number | null;
  meta: AlertSubjectMeta;
}) {
  const href = subjectPath(subjectType, projectId, subjectId, testRunId);
  if (projectId == null && subjectType !== AlertSubjectType.LLM_INTEGRATION) {
    return <span>{subjectName}</span>;
  }
  // Only the AI integration branch runs without a project, and it never
  // reads this.
  const ownerProjectId = projectId ?? 0;
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
          projectId={ownerProjectId}
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
          projectId={ownerProjectId}
          size="sm"
        />
      );
    }
    case AlertSubjectType.SESSION:
      return (
        <Link href={href} className="text-primary hover:underline">
          <SessionNameDisplay
            session={{
              id: subjectId,
              name: subjectName,
              isDeleted: meta.sessions.get(subjectId)?.isDeleted,
            }}
            className="truncate"
          />
        </Link>
      );
    case AlertSubjectType.PROJECT:
      return (
        <div className="flex items-start gap-1.5">
          <span className="mt-0.5 shrink-0">
            <ProjectIcon
              iconUrl={meta.projects.get(subjectId)?.iconUrl}
              width={16}
              height={16}
            />
          </span>
          <ProjectNameCell
            projectId={ownerProjectId}
            value={subjectName}
            size="sm"
          />
        </div>
      );
    case AlertSubjectType.WEBHOOK:
      return (
        <Link
          href={href}
          className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
        >
          <Webhook className="h-4 w-4 shrink-0" />
          <span className="truncate">{subjectName}</span>
        </Link>
      );
    case AlertSubjectType.LLM_INTEGRATION:
      return (
        <Link
          href={href}
          className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="truncate">{subjectName}</span>
        </Link>
      );
    default:
      return <span>{subjectName}</span>;
  }
}

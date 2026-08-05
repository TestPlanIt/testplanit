"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import DynamicIcon from "@/components/DynamicIcon";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import {
  Bot,
  Boxes,
  Bug,
  CalendarIcon,
  CheckCircle,
  Clock,
  Combine,
  Compass,
  FileText,
  FolderTree,
  GitBranch,
  Layers,
  LayoutTemplate,
  ListChecks,
  Milestone,
  PlayCircle,
  Settings,
  Tags,
  Timer,
  Trash2,
  User,
  UserCheck,
  Workflow,
  LayoutList,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  BaseEntityFilters,
  IssueFilters,
  MilestoneFilters,
  RepositoryCaseFilters,
  SearchableEntityType,
  SearchFacet,
  SessionFilters,
  TestRunFilters,
  UnifiedSearchFilters,
} from "~/types/search";
import { searchIssues } from "~/app/actions/searchIssues";
import { cn, isAdmin } from "~/utils";
import { CustomFieldFilters } from "./CustomFieldFilters";

/** The entity a workflow's states belong to. */
type WorkflowScope = "CASES" | "RUNS" | "SESSIONS";

/** One row of the issue picker — mirrors what `searchIssues` selects. */
interface IssueOption {
  id: number;
  name: string;
  title: string;
  externalKey: string | null;
}

/** How many options a filter combobox shows per page. */
const OPTION_PAGE_SIZE = 20;

/**
 * Durations are indexed in seconds, but the range inputs are labelled in
 * minutes — so the filter itself carries seconds and these convert at the edge.
 */
const SECONDS_PER_MINUTE = 60;

const secondsToMinutes = (seconds?: number) =>
  seconds === undefined ? "" : Math.round(seconds / SECONDS_PER_MINUTE);

const minutesToSeconds = (value: string) => {
  const minutes = parseInt(value, 10);
  return Number.isNaN(minutes) ? undefined : minutes * SECONDS_PER_MINUTE;
};

/**
 * The queries below already load every option the viewer is allowed to see, so
 * the comboboxes search and page through that list in memory instead of
 * hitting the server again.
 */
function localOptionFetcher<T>(items: T[], getLabel: (item: T) => string) {
  return async (query: string, page: number, pageSize: number) => {
    const term = query.trim().toLowerCase();
    const matches = term
      ? items.filter((item) => getLabel(item).toLowerCase().includes(term))
      : items;
    return {
      results: matches.slice(page * pageSize, (page + 1) * pageSize),
      total: matches.length,
    };
  };
}

/**
 * Maps the combobox selection back to ids, keeping any id that isn't in the
 * loaded option list — a saved search can reference entities the current
 * queries don't return, and those shouldn't silently disappear.
 */
function mergeSelectedIds<Id, T>(
  currentIds: Id[] | undefined,
  loaded: T[] | undefined,
  selected: T[],
  getId: (item: T) => Id
): Id[] {
  const loadedIds = new Set((loaded ?? []).map(getId));
  const preserved = (currentIds ?? []).filter((id) => !loadedIds.has(id));
  return [...preserved, ...selected.map(getId)];
}

/** Option label plus its facet count, when the search returned one. */
function OptionLabel({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <span className="flex items-center gap-1 min-w-0">
      <span className="truncate">{children}</span>
      {count !== undefined && (
        <span className="text-muted-foreground shrink-0">{`(${count})`}</span>
      )}
    </span>
  );
}

interface FacetedSearchFiltersProps {
  entityTypes: SearchableEntityType[];
  filters: UnifiedSearchFilters;
  onFiltersChange: (filters: UnifiedSearchFilters) => void;
  projectId?: number;
  facetCounts?: Record<string, SearchFacet>;
}

export function FacetedSearchFilters({
  entityTypes,
  filters,
  onFiltersChange,
  projectId,
  facetCounts,
}: FacetedSearchFiltersProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const [localFilters, setLocalFilters] =
    useState<UnifiedSearchFilters>(filters);
  // Issues picked from the dropdown this session, so their chips render
  // without waiting on the hydration query below.
  const [pickedIssues, setPickedIssues] = useState<IssueOption[]>([]);

  // Fetch data for filters
  // Note: ZenStack handles access control automatically based on schema policies
  // Project-scoped entities with access control: Workflows, Templates, Milestones, Folders, Users
  // - Admins see all entities
  // - Non-admins see only entities from their assigned projects
  // Global entities: Projects (ZenStack handles), Tags, Configurations
  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
    orderBy: [
      { isCompleted: "asc" }, // Active projects first
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      isCompleted: true,
    },
  });

  // Map entity types to workflow scopes
  const getWorkflowScopes = () => {
    const scopes: WorkflowScope[] = [];
    if (entityTypes.includes(SearchableEntityType.REPOSITORY_CASE)) {
      scopes.push("CASES");
    }
    if (entityTypes.includes(SearchableEntityType.TEST_RUN)) {
      scopes.push("RUNS");
    }
    if (entityTypes.includes(SearchableEntityType.SESSION)) {
      scopes.push("SESSIONS");
    }
    return scopes;
  };

  const workflowScopes = getWorkflowScopes();

  // Get current user's project assignments for access control (non-admin users only)
  const { data: currentUserProjects } = useClientQueries(
    schema
  ).projectAssignment.useFindMany(
    {
      where: {
        userId: session?.user?.id || "",
      },
      select: {
        projectId: true,
      },
    },
    {
      enabled:
        !!session?.user?.id && session?.user?.access !== "ADMIN" && !projectId,
    }
  );

  const currentUserProjectIds =
    currentUserProjects?.map((p) => p.projectId) || [];

  // Fetch workflow states - filtered by scope and project access
  const { data: workflowStates } = useClientQueries(
    schema
  ).workflows.useFindMany(
    {
      where: {
        isDeleted: false,
        isEnabled: true,
        scope: { in: workflowScopes },
        // If searching within a specific project, only show workflows assigned to that project
        // If global search and user is not admin, only show workflows from projects the user has access to
        ...(projectId
          ? {
              projects: {
                some: {
                  projectId: projectId,
                },
              },
            }
          : session?.user?.access !== "ADMIN" &&
              currentUserProjectIds.length > 0
            ? {
                projects: {
                  some: {
                    projectId: {
                      in: currentUserProjectIds,
                    },
                  },
                },
              }
            : session?.user?.access !== "ADMIN" &&
                currentUserProjectIds.length === 0
              ? {
                  id: {
                    in: [], // No projects = no workflow states visible
                  },
                }
              : {}),
      },
      orderBy: { order: "asc" },
      include: {
        icon: true,
        color: true,
      },
    },
    { enabled: workflowScopes.length > 0 }
  );

  type WorkflowStateOption = NonNullable<typeof workflowStates>[number];

  /** States split by the entity they belong to, so each entity section can
   *  offer only its own states instead of one mixed list. */
  const statesByScope = useMemo(() => {
    const grouped: Record<WorkflowScope, WorkflowStateOption[]> = {
      CASES: [],
      RUNS: [],
      SESSIONS: [],
    };
    for (const state of workflowStates ?? []) {
      grouped[state.scope]?.push(state);
    }
    return grouped;
  }, [workflowStates]);

  const { data: tags } = useClientQueries(schema).tags.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  const { data: templates } = useClientQueries(schema).templates.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      // If searching within a specific project, only show templates assigned to that project
      // If global search and user is not admin, only show templates from projects the user has access to
      ...(projectId
        ? {
            projects: {
              some: {
                projectId: projectId,
              },
            },
          }
        : session?.user?.access !== "ADMIN" && currentUserProjectIds.length > 0
          ? {
              projects: {
                some: {
                  projectId: {
                    in: currentUserProjectIds,
                  },
                },
              },
            }
          : session?.user?.access !== "ADMIN" &&
              currentUserProjectIds.length === 0
            ? {
                id: {
                  in: [], // No projects = no templates visible
                },
              }
            : {}),
    },
    orderBy: { templateName: "asc" },
  });

  const { data: milestones } = useClientQueries(schema).milestones.useFindMany({
    where: {
      isDeleted: false,
      // If searching within a specific project, only show milestones from that project
      // If global search and user is not admin, only show milestones from projects the user has access to
      ...(projectId
        ? { projectId }
        : session?.user?.access !== "ADMIN" && currentUserProjectIds.length > 0
          ? {
              projectId: {
                in: currentUserProjectIds,
              },
            }
          : session?.user?.access !== "ADMIN" &&
              currentUserProjectIds.length === 0
            ? {
                projectId: {
                  in: [], // No projects = no milestones visible
                },
              }
            : {}),
    },
    orderBy: { name: "asc" },
  });

  const { data: configurations } = useClientQueries(
    schema
  ).configurations.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      // When searching within a project, only surface configurations assigned
      // to that project (configurations are project-scoped).
      ...(projectId ? { projects: { some: { projectId } } } : {}),
    },
    orderBy: { name: "asc" },
  });

  const { data: users } = useClientQueries(schema).user.useFindMany({
    where: {
      isDeleted: false,
      isActive: true,
      // If searching within a specific project, only show users assigned to that project
      // If global search and user is not admin, only show users from projects shared with current user
      ...(projectId
        ? {
            projects: {
              some: {
                projectId: projectId,
              },
            },
          }
        : session?.user?.access !== "ADMIN" && currentUserProjectIds.length > 0
          ? {
              projects: {
                some: {
                  projectId: {
                    in: currentUserProjectIds,
                  },
                },
              },
            }
          : session?.user?.access !== "ADMIN" &&
              currentUserProjectIds.length === 0
            ? {
                id: {
                  in: [], // No projects = no users visible
                },
              }
            : {}),
    },
    orderBy: { name: "asc" },
  });

  const { data: folders } = useClientQueries(
    schema
  ).repositoryFolders.useFindMany({
    where: {
      isDeleted: false,
      // If searching within a specific project, only show folders from that project
      // If global search and user is not admin, only show folders from projects the user has access to
      ...(projectId
        ? { projectId }
        : session?.user?.access !== "ADMIN" && currentUserProjectIds.length > 0
          ? {
              projectId: {
                in: currentUserProjectIds,
              },
            }
          : session?.user?.access !== "ADMIN" &&
              currentUserProjectIds.length === 0
            ? {
                projectId: {
                  in: [], // No projects = no folders visible
                },
              }
            : {}),
    },
    orderBy: [
      { order: "asc" }, // Primary sort by custom order field
      { name: "asc" }, // Secondary sort by name
    ],
  });

  // The issue picker pages against the server, so ids restored from a saved
  // search have to be hydrated separately or their chips would be nameless.
  const selectedIssueIds = localFilters.issue?.issueIds ?? [];
  const { data: hydratedIssues } = useClientQueries(schema).issue.useFindMany(
    {
      where: { id: { in: selectedIssueIds } },
      select: { id: true, name: true, title: true, externalKey: true },
    },
    { enabled: selectedIssueIds.length > 0 }
  );

  // Update local filters when props change
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Clear all filters
  const clearAllFilters = () => {
    const clearedFilters: UnifiedSearchFilters = {
      query: localFilters.query,
      entityTypes: localFilters.entityTypes,
    };
    setLocalFilters(clearedFilters);
    onFiltersChange(clearedFilters);
  };

  // Get active filter count
  const getActiveFilterCount = () => {
    let count = 0;

    // Count base filters only once (not per entity type)
    const baseFilters = getBaseFilters();
    if (baseFilters.projectIds?.length) count++;
    if (baseFilters.tagIds?.length) count++;
    if (baseFilters.creatorIds?.length) count++;
    if (baseFilters.dateRange?.from || baseFilters.dateRange?.to) count++;
    if (localFilters.includeDeleted) count++;

    // Count entity-specific filters (excluding base filters already counted)
    entityTypes.forEach((entityType) => {
      const entityFilters = getEntityFilters(entityType);
      if (!entityFilters) return;

      switch (entityType) {
        case SearchableEntityType.REPOSITORY_CASE:
          const repoFilters = entityFilters as RepositoryCaseFilters;
          if (repoFilters.stateIds?.length) count++;
          if (repoFilters.folderIds?.length) count++;
          if (repoFilters.templateIds?.length) count++;
          if (repoFilters.automated !== undefined) count++;
          if (repoFilters.isArchived !== undefined) count++;
          if (repoFilters.customFields?.length) count++;
          if (repoFilters.source?.length) count++;
          if (
            repoFilters.estimateRange?.min !== undefined ||
            repoFilters.estimateRange?.max !== undefined
          )
            count++;
          break;
        case SearchableEntityType.TEST_RUN:
          const runFilters = entityFilters as TestRunFilters;
          if (runFilters.stateIds?.length) count++;
          if (runFilters.configurationIds?.length) count++;
          if (runFilters.milestoneIds?.length) count++;
          if (runFilters.isCompleted !== undefined) count++;
          if (runFilters.testRunType) count++;
          if (
            runFilters.elapsedRange?.min !== undefined ||
            runFilters.elapsedRange?.max !== undefined
          )
            count++;
          break;
        case SearchableEntityType.SESSION:
          const sessionFilters = entityFilters as SessionFilters;
          if (sessionFilters.stateIds?.length) count++;
          if (sessionFilters.templateIds?.length) count++;
          if (sessionFilters.assignedToIds?.length) count++;
          if (sessionFilters.configurationIds?.length) count++;
          if (sessionFilters.isCompleted !== undefined) count++;
          if (
            sessionFilters.estimateRange?.min !== undefined ||
            sessionFilters.estimateRange?.max !== undefined
          )
            count++;
          if (
            sessionFilters.elapsedRange?.min !== undefined ||
            sessionFilters.elapsedRange?.max !== undefined
          )
            count++;
          break;
        case SearchableEntityType.ISSUE:
          const issueFilters = entityFilters as IssueFilters;
          if (issueFilters.issueIds?.length) count++;
          break;
        case SearchableEntityType.MILESTONE:
          const milestoneFilters = entityFilters as MilestoneFilters;
          if (milestoneFilters.isCompleted !== undefined) count++;
          break;
      }
    });

    return count;
  };

  // Get base filters that apply to all entities
  const getBaseFilters = (): BaseEntityFilters => {
    return {
      projectIds:
        localFilters.repositoryCase?.projectIds ||
        localFilters.testRun?.projectIds ||
        localFilters.session?.projectIds ||
        localFilters.sharedStep?.projectIds ||
        localFilters.issue?.projectIds ||
        localFilters.milestone?.projectIds ||
        [],
      tagIds:
        localFilters.repositoryCase?.tagIds ||
        localFilters.testRun?.tagIds ||
        localFilters.session?.tagIds ||
        [],
      creatorIds:
        localFilters.repositoryCase?.creatorIds ||
        localFilters.testRun?.creatorIds ||
        localFilters.session?.creatorIds ||
        [],
      includeDeleted:
        localFilters.repositoryCase?.includeDeleted ||
        localFilters.testRun?.includeDeleted ||
        localFilters.session?.includeDeleted ||
        localFilters.sharedStep?.includeDeleted ||
        localFilters.issue?.includeDeleted ||
        localFilters.milestone?.includeDeleted ||
        localFilters.includeDeleted,
      dateRange:
        localFilters.repositoryCase?.dateRange ||
        localFilters.testRun?.dateRange ||
        localFilters.session?.dateRange,
    };
  };

  // Get entity-specific filters
  const getEntityFilters = (entityType: SearchableEntityType) => {
    switch (entityType) {
      case SearchableEntityType.REPOSITORY_CASE:
        return localFilters.repositoryCase;
      case SearchableEntityType.TEST_RUN:
        return localFilters.testRun;
      case SearchableEntityType.SESSION:
        return localFilters.session;
      case SearchableEntityType.SHARED_STEP:
        return localFilters.sharedStep;
      case SearchableEntityType.ISSUE:
        return localFilters.issue;
      case SearchableEntityType.MILESTONE:
        return localFilters.milestone;
      default:
        return null;
    }
  };

  // Update base filters for all selected entity types
  const updateBaseFilters = (updates: Partial<BaseEntityFilters>) => {
    const newFilters = { ...localFilters };

    entityTypes.forEach((entityType) => {
      switch (entityType) {
        case SearchableEntityType.REPOSITORY_CASE:
          newFilters.repositoryCase = {
            ...newFilters.repositoryCase,
            ...updates,
          };
          break;
        case SearchableEntityType.TEST_RUN:
          newFilters.testRun = { ...newFilters.testRun, ...updates };
          break;
        case SearchableEntityType.SESSION:
          newFilters.session = { ...newFilters.session, ...updates };
          break;
        case SearchableEntityType.SHARED_STEP:
          newFilters.sharedStep = {
            ...newFilters.sharedStep,
            ...updates,
            projectIds:
              updates.projectIds || newFilters.sharedStep?.projectIds || [],
          };
          break;
        case SearchableEntityType.ISSUE:
          newFilters.issue = { ...newFilters.issue, ...updates };
          break;
        case SearchableEntityType.MILESTONE:
          newFilters.milestone = { ...newFilters.milestone, ...updates };
          break;
      }
    });

    setLocalFilters(newFilters);
    // Apply filters immediately for faceted search experience
    onFiltersChange(newFilters);
  };

  // Update entity-specific filters
  const updateEntityFilters = (
    entityType: SearchableEntityType,
    updates: any
  ) => {
    const newFilters = { ...localFilters };

    switch (entityType) {
      case SearchableEntityType.REPOSITORY_CASE:
        newFilters.repositoryCase = {
          ...newFilters.repositoryCase,
          ...updates,
        };
        break;
      case SearchableEntityType.TEST_RUN:
        newFilters.testRun = { ...newFilters.testRun, ...updates };
        break;
      case SearchableEntityType.SESSION:
        newFilters.session = { ...newFilters.session, ...updates };
        break;
      case SearchableEntityType.SHARED_STEP:
        newFilters.sharedStep = { ...newFilters.sharedStep, ...updates };
        break;
      case SearchableEntityType.ISSUE:
        newFilters.issue = { ...newFilters.issue, ...updates };
        break;
      case SearchableEntityType.MILESTONE:
        newFilters.milestone = { ...newFilters.milestone, ...updates };
        break;
    }

    setLocalFilters(newFilters);
    // Apply filters immediately for faceted search experience
    onFiltersChange(newFilters);
  };

  const baseFilters = getBaseFilters();
  const activeFilterCount = getActiveFilterCount();

  // Get display info for entity type
  const getEntityTypeInfo = (entityType: SearchableEntityType) => {
    const typeMap: Record<
      SearchableEntityType,
      { translationKey: string; icon: any }
    > = {
      [SearchableEntityType.REPOSITORY_CASE]: {
        translationKey: "search.entityTypes.repositoryCase",
        icon: ListChecks,
      },
      [SearchableEntityType.SHARED_STEP]: {
        translationKey: "common.fields.sharedSteps",
        icon: Layers,
      },
      [SearchableEntityType.TEST_RUN]: {
        translationKey: "common.fields.testRuns",
        icon: PlayCircle,
      },
      [SearchableEntityType.SESSION]: {
        translationKey: "common.fields.sessions",
        icon: Compass,
      },
      [SearchableEntityType.PROJECT]: {
        translationKey: "common.fields.projects",
        icon: Boxes,
      },
      [SearchableEntityType.ISSUE]: {
        translationKey: "common.fields.issues",
        icon: Bug,
      },
      [SearchableEntityType.MILESTONE]: {
        translationKey: "common.fields.milestones",
        icon: Milestone,
      },
    };
    const info = typeMap[entityType];
    return {
      name: t(info.translationKey as any),
      Icon: info.icon,
    };
  };

  // Facet count for an option, when the current search produced one
  const getFacetCount = (facet: string, key: string | number) =>
    facetCounts?.[facet]?.buckets.find((b) => b.key === String(key))?.doc_count;

  // Option fetchers — memoized so the comboboxes don't refetch on every render
  const fetchProjects = useMemo(
    () => localOptionFetcher(projects ?? [], (p) => p.name),
    [projects]
  );
  const fetchCaseStates = useMemo(
    () => localOptionFetcher(statesByScope.CASES, (s) => s.name),
    [statesByScope]
  );
  const fetchRunStates = useMemo(
    () => localOptionFetcher(statesByScope.RUNS, (s) => s.name),
    [statesByScope]
  );
  const fetchSessionStates = useMemo(
    () => localOptionFetcher(statesByScope.SESSIONS, (s) => s.name),
    [statesByScope]
  );
  const fetchTags = useMemo(
    () => localOptionFetcher(tags ?? [], (tag) => tag.name),
    [tags]
  );
  const fetchUsers = useMemo(
    () => localOptionFetcher(users ?? [], (u) => u.name ?? ""),
    [users]
  );
  const fetchFolders = useMemo(
    () => localOptionFetcher(folders ?? [], (f) => f.name),
    [folders]
  );
  const fetchTemplates = useMemo(
    () => localOptionFetcher(templates ?? [], (tpl) => tpl.templateName),
    [templates]
  );
  const fetchConfigurations = useMemo(
    () => localOptionFetcher(configurations ?? [], (c) => c.name),
    [configurations]
  );
  const fetchMilestones = useMemo(
    () => localOptionFetcher(milestones ?? [], (m) => m.name),
    [milestones]
  );
  // Issues are the one option list too large to hold in memory, so they page
  // against the database instead.
  const fetchIssues = useMemo(
    () => (query: string, page: number, pageSize: number) =>
      searchIssues(query, page, pageSize, projectId),
    [projectId]
  );

  // Selected ids resolved back to the option rows the comboboxes render
  const selectedProjects = (projects ?? []).filter((p) =>
    baseFilters.projectIds?.includes(p.id)
  );
  const selectedTags = (tags ?? []).filter((tag) =>
    baseFilters.tagIds?.includes(tag.id)
  );
  const selectedCreators = (users ?? []).filter((u) =>
    baseFilters.creatorIds?.includes(u.id)
  );
  const selectedFolders = (folders ?? []).filter((f) =>
    localFilters.repositoryCase?.folderIds?.includes(f.id)
  );
  const selectedCaseTemplates = (templates ?? []).filter((tpl) =>
    localFilters.repositoryCase?.templateIds?.includes(tpl.id)
  );
  const selectedRunConfigurations = (configurations ?? []).filter((c) =>
    localFilters.testRun?.configurationIds?.includes(c.id)
  );
  const selectedRunMilestones = (milestones ?? []).filter((m) =>
    localFilters.testRun?.milestoneIds?.includes(m.id)
  );
  const selectedSessionTemplates = (templates ?? []).filter((tpl) =>
    localFilters.session?.templateIds?.includes(tpl.id)
  );
  const selectedAssignees = (users ?? []).filter((u) =>
    localFilters.session?.assignedToIds?.includes(u.id)
  );
  // Issue chips come from whichever source knows the issue: the ones just
  // picked from the dropdown, falling back to the hydration query for ids that
  // arrived with a saved search.
  const pickedIssuesById = new Map(pickedIssues.map((i) => [i.id, i]));
  const hydratedIssuesById = new Map(
    (hydratedIssues ?? []).map((i) => [i.id, i])
  );
  const selectedIssues = selectedIssueIds
    .map((id) => pickedIssuesById.get(id) ?? hydratedIssuesById.get(id))
    .filter((issue): issue is IssueOption => issue !== undefined);

  /**
   * The workflow state picker for one entity. A state belongs to a single
   * entity, so the picker offers only that entity's states and writes to that
   * entity's filters — a case state must not narrow the run results.
   */
  const renderStatePicker = (
    entityType: SearchableEntityType,
    states: WorkflowStateOption[],
    fetchStates: ReturnType<typeof localOptionFetcher<WorkflowStateOption>>,
    testId: string
  ) => {
    if (states.length === 0) return null;
    const stateIds = (getEntityFilters(entityType) as BaseEntityFilters | null)
      ?.stateIds;
    const selected = states.filter((s) => stateIds?.includes(s.id));
    return (
      <div className="space-y-2" data-testid={testId}>
        <Label className="text-sm font-medium flex items-center gap-1">
          <Workflow className="h-4 w-4" />
          {t("search.filters.states")}
        </Label>
        <MultiAsyncCombobox
          value={selected}
          onValueChange={(picked) =>
            updateEntityFilters(entityType, {
              stateIds: mergeSelectedIds(
                stateIds,
                states,
                picked,
                (state) => state.id
              ),
            })
          }
          fetchOptions={fetchStates}
          renderOption={(state) => (
            <span className="flex items-center gap-1 min-w-0">
              {state.icon && (
                <DynamicIcon
                  name={
                    state.icon
                      .name as keyof typeof import("lucide-react/dynamicIconImports").default
                  }
                  className="h-4 w-4 shrink-0"
                  style={{ color: state.color?.value }}
                />
              )}
              <OptionLabel count={getFacetCount("states", state.id)}>
                {state.name}
              </OptionLabel>
            </span>
          )}
          renderSelectedOption={(state) => (
            <span className="flex items-center gap-1 min-w-0">
              {state.icon && (
                <DynamicIcon
                  name={
                    state.icon
                      .name as keyof typeof import("lucide-react/dynamicIconImports").default
                  }
                  className="h-3 w-3 shrink-0"
                  style={{ color: state.color?.value }}
                />
              )}
              <span className="truncate">{state.name}</span>
            </span>
          )}
          getOptionValue={(state) => state.id}
          getOptionLabel={(state) => state.name}
          placeholder={t("common.placeholders.selectStates")}
          pageSize={OPTION_PAGE_SIZE}
        />
      </div>
    );
  };

  return (
    <div
      className="flex h-full w-full flex-col gap-4 overflow-x-hidden"
      data-testid="faceted-search-filters"
    >
      {/* Header — pe-8 keeps the Clear All button clear of the sheet's close button */}
      <div className="flex items-center justify-between pe-8">
        <div>
          <h3 className="text-lg font-semibold">{t("search.filters.title")}</h3>
          {activeFilterCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("search.filters.activeCount", { count: activeFilterCount })}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAllFilters}
          disabled={activeFilterCount === 0}
        >
          {t("common.actions.clearAll")}
        </Button>
      </div>

      <Separator />

      <ScrollArea className="min-h-0 w-full flex-1 pe-3">
        {/* Selected Entity Types */}
        {entityTypes.length > 0 && (
          <div className="mb-4">
            <Label className="text-sm font-medium mb-2 block">
              {t("search.filters.searchingIn")}
            </Label>
            <div className="flex flex-wrap gap-2">
              {entityTypes.map((entityType) => {
                const { name, Icon } = getEntityTypeInfo(entityType);
                return (
                  <div
                    key={entityType}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium"
                  >
                    <Icon className="h-3 w-3" />
                    {name}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Accordion
          type="multiple"
          defaultValue={["common", "entity-specific"]}
          className="w-full overflow-x-hidden"
        >
          {/* Common Filters */}
          <AccordionItem value="common">
            <AccordionTrigger>
              <div className="flex items-center gap-1">
                <Settings className="h-4 w-4" />
                {t("search.filters.common")}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 overflow-x-hidden min-w-0 pl-2">
              {/* Projects */}
              {projects && projects.length > 0 && !projectId && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-1">
                    <Boxes className="h-4 w-4" />
                    {t("common.fields.projects")}
                  </Label>
                  <MultiAsyncCombobox
                    value={selectedProjects}
                    onValueChange={(selected) =>
                      updateBaseFilters({
                        projectIds: mergeSelectedIds(
                          baseFilters.projectIds,
                          projects,
                          selected,
                          (p) => p.id
                        ),
                      })
                    }
                    fetchOptions={fetchProjects}
                    renderOption={(project) => (
                      <span
                        className={cn(
                          "flex items-center gap-1 min-w-0",
                          project.isCompleted &&
                            "text-muted-foreground line-through"
                        )}
                      >
                        {project.isCompleted && (
                          <CheckCircle className="h-3 w-3 shrink-0" />
                        )}
                        <OptionLabel
                          count={getFacetCount("projects", project.id)}
                        >
                          {project.name}
                        </OptionLabel>
                      </span>
                    )}
                    getOptionValue={(project) => project.id}
                    getOptionLabel={(project) => project.name}
                    placeholder={t("common.placeholders.selectProjects")}
                    pageSize={OPTION_PAGE_SIZE}
                  />
                </div>
              )}

              {/* Tags */}
              {tags && tags.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-1">
                    <Tags className="h-4 w-4" />
                    {t("common.fields.tags")}
                  </Label>
                  <MultiAsyncCombobox
                    value={selectedTags}
                    onValueChange={(selected) =>
                      updateBaseFilters({
                        tagIds: mergeSelectedIds(
                          baseFilters.tagIds,
                          tags,
                          selected,
                          (tag) => tag.id
                        ),
                      })
                    }
                    fetchOptions={fetchTags}
                    renderOption={(tag) => (
                      <OptionLabel count={getFacetCount("tags", tag.id)}>
                        {tag.name}
                      </OptionLabel>
                    )}
                    getOptionValue={(tag) => tag.id}
                    getOptionLabel={(tag) => tag.name}
                    placeholder={t("common.placeholders.selectTags")}
                    pageSize={OPTION_PAGE_SIZE}
                  />
                </div>
              )}

              {/* Created By */}
              {users && users.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-1">
                    <User className="h-4 w-4" />
                    {t("common.fields.createdBy")}
                  </Label>
                  <MultiAsyncCombobox
                    value={selectedCreators}
                    onValueChange={(selected) =>
                      updateBaseFilters({
                        creatorIds: mergeSelectedIds(
                          baseFilters.creatorIds,
                          users,
                          selected,
                          (user) => user.id
                        ),
                      })
                    }
                    fetchOptions={fetchUsers}
                    renderOption={(user) => (
                      <OptionLabel count={getFacetCount("creators", user.id)}>
                        {user.name}
                      </OptionLabel>
                    )}
                    getOptionValue={(user) => user.id}
                    getOptionLabel={(user) => user.name ?? ""}
                    placeholder={t("common.placeholders.selectUsers")}
                    pageSize={OPTION_PAGE_SIZE}
                  />
                </div>
              )}

              {/* Date Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <CalendarIcon className="h-4 w-4" />
                  {t("runs.summary.recentResultsDateRange")}
                </Label>
                <div className="space-y-2">
                  <Select
                    value={baseFilters.dateRange?.field || "createdAt"}
                    onValueChange={(field: any) => {
                      updateBaseFilters({
                        dateRange: {
                          ...baseFilters.dateRange,
                          field,
                        },
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="createdAt">
                        {t("search.filters.createdAt")}
                      </SelectItem>
                      <SelectItem value="updatedAt">
                        {t("search.filters.updatedAt")}
                      </SelectItem>
                      <SelectItem value="completedAt">
                        {t("search.filters.completedAt")}
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="grid grid-cols-2 gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "justify-start text-start font-normal min-w-0 w-full",
                            !baseFilters.dateRange?.from &&
                              "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {baseFilters.dateRange?.from
                              ? format(baseFilters.dateRange.from, "PP")
                              : t("search.filters.from")}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={baseFilters.dateRange?.from}
                          onSelect={(date) => {
                            updateBaseFilters({
                              dateRange: {
                                ...baseFilters.dateRange,
                                field:
                                  baseFilters.dateRange?.field || "createdAt",
                                from: date,
                              },
                            });
                          }}
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>

                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "justify-start text-start font-normal min-w-0 w-full",
                            !baseFilters.dateRange?.to &&
                              "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {baseFilters.dateRange?.to
                              ? format(baseFilters.dateRange.to, "PP")
                              : t("search.filters.to")}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={baseFilters.dateRange?.to}
                          onSelect={(date) => {
                            updateBaseFilters({
                              dateRange: {
                                ...baseFilters.dateRange,
                                field:
                                  baseFilters.dateRange?.field || "createdAt",
                                to: date,
                              },
                            });
                          }}
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>

              {/* Show Deleted Items - Admin Only */}
              {isAdmin(session) && (
                <div className="flex items-center space-x-2">
                  <Switch
                    id="include-deleted"
                    data-testid="include-deleted-toggle"
                    checked={localFilters.includeDeleted || false}
                    onCheckedChange={(checked) => {
                      const newFilters = {
                        ...localFilters,
                        includeDeleted: checked,
                      };
                      setLocalFilters(newFilters);
                      onFiltersChange(newFilters);
                    }}
                  />
                  <Label
                    htmlFor="include-deleted"
                    className="text-sm font-medium flex items-center gap-1"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("search.filters.includeDeleted")}
                  </Label>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Entity-Specific Filters */}
          <AccordionItem value="entity-specific">
            <AccordionTrigger>
              <div className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                {t("search.filters.entitySpecific")}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 overflow-x-hidden min-w-0 px-1">
              {/* Repository Case Filters */}
              {entityTypes.includes(SearchableEntityType.REPOSITORY_CASE) && (
                <div className="space-y-4 p-4 bg-muted rounded-lg border border-border/50 max-w-full overflow-x-hidden">
                  <h4 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">
                    {t("search.entityTypes.repositoryCase")}
                  </h4>

                  {/* Workflow States */}
                  {renderStatePicker(
                    SearchableEntityType.REPOSITORY_CASE,
                    statesByScope.CASES,
                    fetchCaseStates,
                    "case-states-filter"
                  )}

                  {/* Folders */}
                  {folders && folders.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-1">
                        <FolderTree className="h-4 w-4" />
                        {t("repository.folders")}
                      </Label>
                      <MultiAsyncCombobox
                        value={selectedFolders}
                        onValueChange={(selected) =>
                          updateEntityFilters(
                            SearchableEntityType.REPOSITORY_CASE,
                            {
                              folderIds: mergeSelectedIds(
                                localFilters.repositoryCase?.folderIds,
                                folders,
                                selected,
                                (folder) => folder.id
                              ),
                            }
                          )
                        }
                        fetchOptions={fetchFolders}
                        renderOption={(folder) => (
                          <OptionLabel
                            count={getFacetCount("folders", folder.id)}
                          >
                            {folder.name}
                          </OptionLabel>
                        )}
                        getOptionValue={(folder) => folder.id}
                        getOptionLabel={(folder) => folder.name}
                        placeholder={t("common.placeholders.selectFolders")}
                        pageSize={OPTION_PAGE_SIZE}
                      />
                    </div>
                  )}

                  {/* Templates */}
                  {templates && templates.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-1">
                        <LayoutTemplate className="h-4 w-4" />
                        {t("common.fields.templates")}
                      </Label>
                      <MultiAsyncCombobox
                        value={selectedCaseTemplates}
                        onValueChange={(selected) =>
                          updateEntityFilters(
                            SearchableEntityType.REPOSITORY_CASE,
                            {
                              templateIds: mergeSelectedIds(
                                localFilters.repositoryCase?.templateIds,
                                templates,
                                selected,
                                (template) => template.id
                              ),
                            }
                          )
                        }
                        fetchOptions={fetchTemplates}
                        renderOption={(template) => (
                          <OptionLabel
                            count={getFacetCount("templates", template.id)}
                          >
                            {template.templateName}
                          </OptionLabel>
                        )}
                        getOptionValue={(template) => template.id}
                        getOptionLabel={(template) => template.templateName}
                        placeholder={t("common.placeholders.selectTemplates")}
                        pageSize={OPTION_PAGE_SIZE}
                      />
                    </div>
                  )}

                  {/* Automation Status */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Bot className="h-4 w-4" />
                      {t("common.ui.search.automationStatus")}
                    </Label>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="automated"
                          checked={
                            localFilters.repositoryCase?.automated === true
                          }
                          onCheckedChange={(checked) => {
                            updateEntityFilters(
                              SearchableEntityType.REPOSITORY_CASE,
                              {
                                automated: checked ? true : undefined,
                              }
                            );
                          }}
                        />
                        <Label htmlFor="automated">
                          {t("search.filters.automatedOnly")}
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="manual"
                          checked={
                            localFilters.repositoryCase?.automated === false
                          }
                          onCheckedChange={(checked) => {
                            updateEntityFilters(
                              SearchableEntityType.REPOSITORY_CASE,
                              {
                                automated: checked ? false : undefined,
                              }
                            );
                          }}
                        />
                        <Label htmlFor="manual">
                          {t("search.filters.manualOnly")}
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* Estimate Range */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Timer className="h-4 w-4" />
                      {t("search.filters.estimateRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.repositoryCase?.estimateRange?.min
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(
                              SearchableEntityType.REPOSITORY_CASE,
                              {
                                estimateRange: {
                                  ...localFilters.repositoryCase?.estimateRange,
                                  min: value,
                                },
                              }
                            );
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.maxValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="∞"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.repositoryCase?.estimateRange?.max
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(
                              SearchableEntityType.REPOSITORY_CASE,
                              {
                                estimateRange: {
                                  ...localFilters.repositoryCase?.estimateRange,
                                  max: value,
                                },
                              }
                            );
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("search.filters.minutes")}
                    </p>
                  </div>

                  {/* Custom Fields */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <LayoutList className="h-4 w-4" />
                      {t("search.customFields")}
                    </Label>
                    <CustomFieldFilters
                      entityType={SearchableEntityType.REPOSITORY_CASE}
                      filters={localFilters.repositoryCase?.customFields || []}
                      onFiltersChange={(customFields) => {
                        updateEntityFilters(
                          SearchableEntityType.REPOSITORY_CASE,
                          {
                            customFields,
                          }
                        );
                      }}
                      projectId={projectId}
                    />
                  </div>
                </div>
              )}

              {/* Test Run Filters */}
              {entityTypes.includes(SearchableEntityType.TEST_RUN) && (
                <div className="space-y-4 p-4 bg-muted rounded-lg border border-border/50 max-w-full overflow-x-hidden">
                  <h4 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">
                    {t("common.fields.testRuns")}
                  </h4>

                  {/* Workflow States */}
                  {renderStatePicker(
                    SearchableEntityType.TEST_RUN,
                    statesByScope.RUNS,
                    fetchRunStates,
                    "run-states-filter"
                  )}

                  {/* Test Run Type */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <GitBranch className="h-4 w-4" />
                      {t("search.filters.testRunType")}
                    </Label>
                    <Select
                      value={localFilters.testRun?.testRunType || "ALL"}
                      onValueChange={(value) => {
                        updateEntityFilters(SearchableEntityType.TEST_RUN, {
                          testRunType:
                            value === "ALL"
                              ? undefined
                              : (value as "REGULAR" | "JUNIT"),
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("search.allTypes")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">
                          {t("search.allTypes")}
                        </SelectItem>
                        <SelectItem value="REGULAR">
                          {t("search.filters.regular")}
                        </SelectItem>
                        <SelectItem value="JUNIT">
                          {t("search.filters.junit")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Configurations */}
                  {configurations && configurations.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-1">
                        <Combine className="h-4 w-4" />
                        {t("common.fields.configurations")}
                      </Label>
                      <MultiAsyncCombobox
                        value={selectedRunConfigurations}
                        onValueChange={(selected) =>
                          updateEntityFilters(SearchableEntityType.TEST_RUN, {
                            configurationIds: mergeSelectedIds(
                              localFilters.testRun?.configurationIds,
                              configurations,
                              selected,
                              (config) => config.id
                            ),
                          })
                        }
                        fetchOptions={fetchConfigurations}
                        renderOption={(config) => (
                          <OptionLabel
                            count={getFacetCount("configurations", config.id)}
                          >
                            {config.name}
                          </OptionLabel>
                        )}
                        getOptionValue={(config) => config.id}
                        getOptionLabel={(config) => config.name}
                        placeholder={t(
                          "common.placeholders.selectConfigurations"
                        )}
                        pageSize={OPTION_PAGE_SIZE}
                      />
                    </div>
                  )}

                  {/* Milestones */}
                  {milestones && milestones.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-1">
                        <Milestone className="h-4 w-4" />
                        {t("common.fields.milestones")}
                      </Label>
                      <MultiAsyncCombobox
                        value={selectedRunMilestones}
                        onValueChange={(selected) =>
                          updateEntityFilters(SearchableEntityType.TEST_RUN, {
                            milestoneIds: mergeSelectedIds(
                              localFilters.testRun?.milestoneIds,
                              milestones,
                              selected,
                              (milestone) => milestone.id
                            ),
                          })
                        }
                        fetchOptions={fetchMilestones}
                        renderOption={(milestone) => (
                          <OptionLabel
                            count={getFacetCount("milestones", milestone.id)}
                          >
                            {milestone.name}
                          </OptionLabel>
                        )}
                        getOptionValue={(milestone) => milestone.id}
                        getOptionLabel={(milestone) => milestone.name}
                        placeholder={t("common.placeholders.selectMilestones")}
                        pageSize={OPTION_PAGE_SIZE}
                      />
                    </div>
                  )}

                  {/* Completed */}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="completed"
                      checked={localFilters.testRun?.isCompleted === true}
                      onCheckedChange={(checked) => {
                        updateEntityFilters(SearchableEntityType.TEST_RUN, {
                          isCompleted: checked ? true : undefined,
                        });
                      }}
                    />
                    <Label
                      htmlFor="completed"
                      className="flex items-center gap-1"
                    >
                      <CheckCircle className="h-4 w-4" />
                      {t("search.filters.completedOnly")}
                    </Label>
                  </div>

                  {/* Elapsed Time Range */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {t("search.filters.elapsedRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.testRun?.elapsedRange?.min
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(SearchableEntityType.TEST_RUN, {
                              elapsedRange: {
                                ...localFilters.testRun?.elapsedRange,
                                min: value,
                              },
                            });
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.maxValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="∞"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.testRun?.elapsedRange?.max
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(SearchableEntityType.TEST_RUN, {
                              elapsedRange: {
                                ...localFilters.testRun?.elapsedRange,
                                max: value,
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("search.filters.minutes")}
                    </p>
                  </div>
                </div>
              )}

              {/* Session Filters */}
              {entityTypes.includes(SearchableEntityType.SESSION) && (
                <div className="space-y-4 p-4 bg-muted rounded-lg border border-border/50 max-w-full overflow-x-hidden">
                  <h4 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">
                    {t("common.fields.sessions")}
                  </h4>

                  {/* Workflow States */}
                  {renderStatePicker(
                    SearchableEntityType.SESSION,
                    statesByScope.SESSIONS,
                    fetchSessionStates,
                    "session-states-filter"
                  )}

                  {/* Session Templates */}
                  {templates && templates.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-1">
                        <LayoutTemplate className="h-4 w-4" />
                        {t("common.fields.templates")}
                      </Label>
                      <MultiAsyncCombobox
                        value={selectedSessionTemplates}
                        onValueChange={(selected) =>
                          updateEntityFilters(SearchableEntityType.SESSION, {
                            templateIds: mergeSelectedIds(
                              localFilters.session?.templateIds,
                              templates,
                              selected,
                              (template) => template.id
                            ),
                          })
                        }
                        fetchOptions={fetchTemplates}
                        renderOption={(template) => (
                          <OptionLabel
                            count={getFacetCount("templates", template.id)}
                          >
                            {template.templateName}
                          </OptionLabel>
                        )}
                        getOptionValue={(template) => template.id}
                        getOptionLabel={(template) => template.templateName}
                        placeholder={t("common.placeholders.selectTemplates")}
                        pageSize={OPTION_PAGE_SIZE}
                      />
                    </div>
                  )}

                  {/* Assigned To */}
                  {users && users.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-1">
                        <UserCheck className="h-4 w-4" />
                        {t("common.fields.assignedTo")}
                      </Label>
                      <MultiAsyncCombobox
                        value={selectedAssignees}
                        onValueChange={(selected) =>
                          updateEntityFilters(SearchableEntityType.SESSION, {
                            assignedToIds: mergeSelectedIds(
                              localFilters.session?.assignedToIds,
                              users,
                              selected,
                              (user) => user.id
                            ),
                          })
                        }
                        fetchOptions={fetchUsers}
                        renderOption={(user) => (
                          <OptionLabel
                            count={getFacetCount("assignedTo", user.id)}
                          >
                            {user.name}
                          </OptionLabel>
                        )}
                        getOptionValue={(user) => user.id}
                        getOptionLabel={(user) => user.name ?? ""}
                        placeholder={t("common.placeholders.selectUsers")}
                        pageSize={OPTION_PAGE_SIZE}
                      />
                    </div>
                  )}

                  {/* Session Completed */}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="session-completed"
                      checked={localFilters.session?.isCompleted === true}
                      onCheckedChange={(checked) => {
                        updateEntityFilters(SearchableEntityType.SESSION, {
                          isCompleted: checked ? true : undefined,
                        });
                      }}
                    />
                    <Label
                      htmlFor="session-completed"
                      className="flex items-center gap-1"
                    >
                      <CheckCircle className="h-4 w-4" />
                      {t("search.filters.completedOnly")}
                    </Label>
                  </div>

                  {/* Session Estimate Range */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Timer className="h-4 w-4" />
                      {t("search.filters.estimateRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.session?.estimateRange?.min
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(SearchableEntityType.SESSION, {
                              estimateRange: {
                                ...localFilters.session?.estimateRange,
                                min: value,
                              },
                            });
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.maxValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="∞"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.session?.estimateRange?.max
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(SearchableEntityType.SESSION, {
                              estimateRange: {
                                ...localFilters.session?.estimateRange,
                                max: value,
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("search.filters.minutes")}
                    </p>
                  </div>

                  {/* Session Elapsed Time Range */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {t("search.filters.elapsedRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.session?.elapsedRange?.min
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(SearchableEntityType.SESSION, {
                              elapsedRange: {
                                ...localFilters.session?.elapsedRange,
                                min: value,
                              },
                            });
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.maxValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="∞"
                          min="0"
                          value={secondsToMinutes(
                            localFilters.session?.elapsedRange?.max
                          )}
                          onChange={(e) => {
                            const value = minutesToSeconds(e.target.value);
                            updateEntityFilters(SearchableEntityType.SESSION, {
                              elapsedRange: {
                                ...localFilters.session?.elapsedRange,
                                max: value,
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("search.filters.minutes")}
                    </p>
                  </div>
                </div>
              )}

              {/* Issue Filters */}
              {entityTypes.includes(SearchableEntityType.ISSUE) && (
                <div className="space-y-4 p-4 bg-muted rounded-lg border border-border/50 max-w-full overflow-x-hidden">
                  <h4 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">
                    {t("common.fields.issues")}
                  </h4>

                  {/* Issues */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Bug className="h-4 w-4" />
                      {t("common.fields.issues")}
                    </Label>
                    <MultiAsyncCombobox<IssueOption>
                      value={selectedIssues}
                      onValueChange={(selected) => {
                        setPickedIssues(selected);
                        updateEntityFilters(SearchableEntityType.ISSUE, {
                          issueIds: selected.map((issue) => issue.id),
                        });
                      }}
                      fetchOptions={fetchIssues}
                      renderOption={(issue) => (
                        <span className="flex items-center gap-1 min-w-0 font-medium">
                          {issue.externalKey && (
                            <span className="shrink-0">
                              {issue.externalKey}
                              {":"}
                            </span>
                          )}
                          <span className="truncate font-normal">
                            {issue.title}
                          </span>
                        </span>
                      )}
                      getOptionValue={(issue) => issue.id}
                      getOptionLabel={(issue) =>
                        issue.externalKey || issue.name
                      }
                      placeholder={t("common.placeholders.selectIssues")}
                      pageSize={OPTION_PAGE_SIZE}
                    />
                  </div>
                </div>
              )}

              {/* Milestone Filters */}
              {entityTypes.includes(SearchableEntityType.MILESTONE) && (
                <div className="space-y-4 p-4 bg-muted rounded-lg border border-border/50 max-w-full overflow-x-hidden">
                  <h4 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">
                    {t("common.fields.milestones")}
                  </h4>

                  {/* Milestone Completed */}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="milestone-completed"
                      checked={localFilters.milestone?.isCompleted === true}
                      onCheckedChange={(checked) => {
                        updateEntityFilters(SearchableEntityType.MILESTONE, {
                          isCompleted: checked ? true : undefined,
                        });
                      }}
                    />
                    <Label
                      htmlFor="milestone-completed"
                      className="flex items-center gap-1"
                    >
                      <CheckCircle className="h-4 w-4" />
                      {t("search.filters.completedOnly")}
                    </Label>
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ScrollArea>

      {/* Clear All Button */}
      {activeFilterCount > 0 && (
        <div className="pt-4 border-t">
          <Button
            variant="outline"
            className="w-full"
            onClick={clearAllFilters}
          >
            {t("common.actions.clearAll")}
          </Button>
        </div>
      )}
    </div>
  );
}

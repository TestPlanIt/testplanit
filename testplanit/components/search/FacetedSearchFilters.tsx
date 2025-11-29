"use client";

import { useState, useEffect } from "react";
import {
  SearchableEntityType,
  UnifiedSearchFilters,
  BaseEntityFilters,
  RepositoryCaseFilters,
  TestRunFilters,
  SessionFilters,
  IssueFilters,
  MilestoneFilters,
  SearchFacet,
} from "~/types/search";
import {
  useFindManyProjects,
  useFindManyWorkflows,
  useFindManyTags,
  useFindManyTemplates,
  useFindManyMilestones,
  useFindManyConfigurations,
  useFindManyUser,
  useFindManyRepositoryFolders,
  useFindManyProjectAssignment,
} from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "~/utils";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CalendarIcon,
  Search,
  Boxes,
  Tags,
  User,
  Workflow,
  Settings,
  FileText,
  Clock,
  CheckCircle,
  Bot,
  Timer,
  GitBranch,
  Hash,
  Calendar as CalendarIcon2,
  PlayCircle,
  FolderTree,
  Milestone,
  Combine,
  UserCheck,
  LayoutTemplate,
  Bug,
  ListChecks,
  Layers,
  Compass,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { CustomFieldFilters } from "./CustomFieldFilters";
import DynamicIcon from "@/components/DynamicIcon";
import { isAdmin } from "~/utils";

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
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch data for filters
  // Note: ZenStack handles access control automatically based on schema policies
  // Project-scoped entities with access control: Workflows, Templates, Milestones, Folders, Users
  // - Admins see all entities
  // - Non-admins see only entities from their assigned projects
  // Global entities: Projects (ZenStack handles), Tags, Configurations
  const { data: projects } = useFindManyProjects({
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
    const scopes: any[] = []; // Using any[] to work with Prisma enum
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
  const { data: currentUserProjects } = useFindManyProjectAssignment(
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
  const { data: workflowStates } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      ...(workflowScopes.length > 0 && { scope: { in: workflowScopes } }),
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
  });

  const { data: tags } = useFindManyTags({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  const { data: templates } = useFindManyTemplates({
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

  const { data: milestones } = useFindManyMilestones({
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

  const { data: configurations } = useFindManyConfigurations({
    where: {
      isDeleted: false,
    },
    orderBy: { name: "asc" },
  });

  const { data: users } = useFindManyUser({
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

  const { data: folders } = useFindManyRepositoryFolders({
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
    if (baseFilters.stateIds?.length) count++;
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
          if (issueFilters.hasExternalId !== undefined) count++;
          break;
        case SearchableEntityType.MILESTONE:
          const milestoneFilters = entityFilters as MilestoneFilters;
          if (milestoneFilters.isCompleted !== undefined) count++;
          if (milestoneFilters.hasParent !== undefined) count++;
          if (
            milestoneFilters.dueDateRange?.from ||
            milestoneFilters.dueDateRange?.to
          )
            count++;
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
      stateIds:
        localFilters.repositoryCase?.stateIds ||
        localFilters.testRun?.stateIds ||
        localFilters.session?.stateIds ||
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
    const typeMap: Record<SearchableEntityType, { key: string; icon: any }> = {
      [SearchableEntityType.REPOSITORY_CASE]: {
        key: "repositoryCase",
        icon: ListChecks,
      },
      [SearchableEntityType.SHARED_STEP]: { key: "sharedStep", icon: Layers },
      [SearchableEntityType.TEST_RUN]: { key: "testRun", icon: PlayCircle },
      [SearchableEntityType.SESSION]: { key: "session", icon: Compass },
      [SearchableEntityType.PROJECT]: { key: "project", icon: Boxes },
      [SearchableEntityType.ISSUE]: { key: "issue", icon: Bug },
      [SearchableEntityType.MILESTONE]: { key: "milestone", icon: Milestone },
    };
    const info = typeMap[entityType];
    return {
      name: t(`search.entityTypes.${info.key}` as any),
      Icon: info.icon,
    };
  };

  // Filter items based on search query
  const filterItems = (items: any[], nameField: string = "name") => {
    if (!searchQuery) return items;
    return items.filter((item) =>
      item[nameField]?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  return (
    <div
      className="space-y-4 max-w-[325px] overflow-x-hidden"
      data-testid="faceted-search-filters"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
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
          {t("search.filters.clearAll")}
        </Button>
      </div>

      <Separator />

      {/* Search within filters */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          type="text"
          placeholder={t("search.filters.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <ScrollArea className="h-[calc(100vh-300px)] w-full">
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
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                {t("search.filters.common")}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 overflow-x-hidden min-w-0 max-w-[325px]">
              {/* Projects */}
              {projects && projects.length > 0 && !projectId && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Boxes className="h-4 w-4" />
                    {t("search.filters.projects")}
                  </Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {filterItems(projects).map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`project-${project.id}`}
                          checked={
                            baseFilters.projectIds?.includes(project.id) ||
                            false
                          }
                          onCheckedChange={(checked) => {
                            const newProjectIds = checked
                              ? [...(baseFilters.projectIds || []), project.id]
                              : (baseFilters.projectIds || []).filter(
                                  (id) => id !== project.id
                                );
                            updateBaseFilters({ projectIds: newProjectIds });
                          }}
                        />
                        <label
                          htmlFor={`project-${project.id}`}
                          className={cn(
                            "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-1 min-w-0",
                            project.isCompleted && "text-muted-foreground"
                          )}
                        >
                          {project.isCompleted && (
                            <CheckCircle className="h-3 w-3 shrink-0" />
                          )}
                          <span
                            className={cn(
                              "truncate",
                              project.isCompleted ? "line-through" : ""
                            )}
                          >
                            {project.name}
                          </span>
                          {(() => {
                            const bucket = facetCounts?.projects?.buckets.find(
                              (b) => b.key === project.id.toString()
                            );
                            return bucket ? (
                              <span className="text-muted-foreground ml-1 shrink-0">
                                {`(${bucket.doc_count})`}
                              </span>
                            ) : null;
                          })()}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Workflow States */}
              {workflowStates && workflowStates.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Workflow className="h-4 w-4" />
                    {t("search.filters.states")}
                  </Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {/* Group states by scope if multiple scopes */}
                    {workflowScopes.length > 1 ? (
                      <>
                        {workflowScopes.includes("CASES") &&
                          filterItems(
                            workflowStates.filter((s) => s.scope === "CASES")
                          ).length > 0 && (
                            <>
                              <div className="text-xs font-semibold text-muted-foreground mt-2 first:mt-0">
                                {t("search.entityTypes.repositoryCase")}
                              </div>
                              {filterItems(
                                workflowStates.filter(
                                  (s) => s.scope === "CASES"
                                )
                              ).map((state) => (
                                <div
                                  key={state.id}
                                  className="flex items-center space-x-2 ml-2"
                                >
                                  <Checkbox
                                    id={`state-${state.id}`}
                                    checked={
                                      baseFilters.stateIds?.includes(
                                        state.id
                                      ) || false
                                    }
                                    onCheckedChange={(checked) => {
                                      const newStateIds = checked
                                        ? [
                                            ...(baseFilters.stateIds || []),
                                            state.id,
                                          ]
                                        : (baseFilters.stateIds || []).filter(
                                            (id) => id !== state.id
                                          );
                                      updateBaseFilters({
                                        stateIds: newStateIds,
                                      });
                                    }}
                                  />
                                  <label
                                    htmlFor={`state-${state.id}`}
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2 min-w-0"
                                  >
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
                                    <span className="truncate">
                                      {state.name}
                                    </span>
                                    {(() => {
                                      const bucket =
                                        facetCounts?.states?.buckets.find(
                                          (b) => b.key === state.id.toString()
                                        );
                                      return bucket ? (
                                        <span className="text-muted-foreground shrink-0">
                                          {`(${bucket.doc_count})`}
                                        </span>
                                      ) : null;
                                    })()}
                                  </label>
                                </div>
                              ))}
                            </>
                          )}
                        {workflowScopes.includes("RUNS") &&
                          filterItems(
                            workflowStates.filter((s) => s.scope === "RUNS")
                          ).length > 0 && (
                            <>
                              <div className="text-xs font-semibold text-muted-foreground mt-2">
                                {t("search.entityTypes.testRun")}
                              </div>
                              {filterItems(
                                workflowStates.filter((s) => s.scope === "RUNS")
                              ).map((state) => (
                                <div
                                  key={state.id}
                                  className="flex items-center space-x-2 ml-2"
                                >
                                  <Checkbox
                                    id={`state-${state.id}`}
                                    checked={
                                      baseFilters.stateIds?.includes(
                                        state.id
                                      ) || false
                                    }
                                    onCheckedChange={(checked) => {
                                      const newStateIds = checked
                                        ? [
                                            ...(baseFilters.stateIds || []),
                                            state.id,
                                          ]
                                        : (baseFilters.stateIds || []).filter(
                                            (id) => id !== state.id
                                          );
                                      updateBaseFilters({
                                        stateIds: newStateIds,
                                      });
                                    }}
                                  />
                                  <label
                                    htmlFor={`state-${state.id}`}
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2 min-w-0"
                                  >
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
                                    <span className="truncate">
                                      {state.name}
                                    </span>
                                    {(() => {
                                      const bucket =
                                        facetCounts?.states?.buckets.find(
                                          (b) => b.key === state.id.toString()
                                        );
                                      return bucket ? (
                                        <span className="text-muted-foreground shrink-0">
                                          {`(${bucket.doc_count})`}
                                        </span>
                                      ) : null;
                                    })()}
                                  </label>
                                </div>
                              ))}
                            </>
                          )}
                        {workflowScopes.includes("SESSIONS") &&
                          filterItems(
                            workflowStates.filter((s) => s.scope === "SESSIONS")
                          ).length > 0 && (
                            <>
                              <div className="text-xs font-semibold text-muted-foreground mt-2">
                                {t("search.entityTypes.session")}
                              </div>
                              {filterItems(
                                workflowStates.filter(
                                  (s) => s.scope === "SESSIONS"
                                )
                              ).map((state) => (
                                <div
                                  key={state.id}
                                  className="flex items-center space-x-2 ml-2"
                                >
                                  <Checkbox
                                    id={`state-${state.id}`}
                                    checked={
                                      baseFilters.stateIds?.includes(
                                        state.id
                                      ) || false
                                    }
                                    onCheckedChange={(checked) => {
                                      const newStateIds = checked
                                        ? [
                                            ...(baseFilters.stateIds || []),
                                            state.id,
                                          ]
                                        : (baseFilters.stateIds || []).filter(
                                            (id) => id !== state.id
                                          );
                                      updateBaseFilters({
                                        stateIds: newStateIds,
                                      });
                                    }}
                                  />
                                  <label
                                    htmlFor={`state-${state.id}`}
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2 min-w-0"
                                  >
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
                                    <span className="truncate">
                                      {state.name}
                                    </span>
                                    {(() => {
                                      const bucket =
                                        facetCounts?.states?.buckets.find(
                                          (b) => b.key === state.id.toString()
                                        );
                                      return bucket ? (
                                        <span className="text-muted-foreground shrink-0">
                                          {`(${bucket.doc_count})`}
                                        </span>
                                      ) : null;
                                    })()}
                                  </label>
                                </div>
                              ))}
                            </>
                          )}
                      </>
                    ) : (
                      /* Single scope - show states without grouping */
                      filterItems(workflowStates).map((state) => (
                        <div
                          key={state.id}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            id={`state-${state.id}`}
                            checked={
                              baseFilters.stateIds?.includes(state.id) || false
                            }
                            onCheckedChange={(checked) => {
                              const newStateIds = checked
                                ? [...(baseFilters.stateIds || []), state.id]
                                : (baseFilters.stateIds || []).filter(
                                    (id) => id !== state.id
                                  );
                              updateBaseFilters({ stateIds: newStateIds });
                            }}
                          />
                          <label
                            htmlFor={`state-${state.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2 min-w-0"
                          >
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
                            <span className="truncate">{state.name}</span>
                            {(() => {
                              const bucket = facetCounts?.states?.buckets.find(
                                (b) => b.key === state.id.toString()
                              );
                              return bucket ? (
                                <span className="text-muted-foreground shrink-0">
                                  {`(${bucket.doc_count})`}
                                </span>
                              ) : null;
                            })()}
                          </label>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Tags */}
              {tags && tags.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Tags className="h-4 w-4" />
                    {t("search.filters.tags")}
                  </Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {filterItems(tags).map((tag) => (
                      <div key={tag.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`tag-${tag.id}`}
                          checked={
                            baseFilters.tagIds?.includes(tag.id) || false
                          }
                          onCheckedChange={(checked) => {
                            const newTagIds = checked
                              ? [...(baseFilters.tagIds || []), tag.id]
                              : (baseFilters.tagIds || []).filter(
                                  (id) => id !== tag.id
                                );
                            updateBaseFilters({ tagIds: newTagIds });
                          }}
                        />
                        <label
                          htmlFor={`tag-${tag.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-1 min-w-0"
                        >
                          <span className="truncate">{tag.name}</span>
                          {(() => {
                            const bucket = facetCounts?.tags?.buckets.find(
                              (b) => b.key === tag.id.toString()
                            );
                            return bucket ? (
                              <span className="text-muted-foreground shrink-0">
                                {`(${bucket.doc_count})`}
                              </span>
                            ) : null;
                          })()}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Created By */}
              {users && users.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {t("search.filters.createdBy")}
                  </Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {filterItems(users).map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`user-${user.id}`}
                          checked={
                            baseFilters.creatorIds?.includes(user.id) || false
                          }
                          onCheckedChange={(checked) => {
                            const newCreatorIds = checked
                              ? [...(baseFilters.creatorIds || []), user.id]
                              : (baseFilters.creatorIds || []).filter(
                                  (id) => id !== user.id
                                );
                            updateBaseFilters({ creatorIds: newCreatorIds });
                          }}
                        />
                        <label
                          htmlFor={`user-${user.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-1 min-w-0"
                        >
                          <span className="truncate">{user.name}</span>
                          {(() => {
                            const bucket = facetCounts?.creators?.buckets.find(
                              (b) => b.key === user.id
                            );
                            return bucket ? (
                              <span className="text-muted-foreground shrink-0">
                                {`(${bucket.doc_count})`}
                              </span>
                            ) : null;
                          })()}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Date Range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  {t("search.filters.dateRange")}
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

                  <div className="grid grid-cols-2 gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "justify-start text-left font-normal min-w-0 w-full",
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
                            "justify-start text-left font-normal min-w-0 w-full",
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
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t("search.filters.entitySpecific")}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 overflow-x-hidden min-w-0 max-w-[325px]">
              {/* Repository Case Filters */}
              {entityTypes.includes(SearchableEntityType.REPOSITORY_CASE) && (
                <div className="space-y-4 p-4 bg-muted rounded-lg border border-border/50 max-w-full overflow-x-hidden">
                  <h4 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">
                    {t("search.entityTypes.repositoryCase")}
                  </h4>

                  {/* Folders */}
                  {folders && folders.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <FolderTree className="h-4 w-4" />
                        {t("search.filters.folders")}
                      </Label>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {filterItems(folders).map((folder) => (
                          <div
                            key={folder.id}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={`folder-${folder.id}`}
                              checked={
                                localFilters.repositoryCase?.folderIds?.includes(
                                  folder.id
                                ) || false
                              }
                              onCheckedChange={(checked) => {
                                const currentFolderIds =
                                  localFilters.repositoryCase?.folderIds || [];
                                const newFolderIds = checked
                                  ? [...currentFolderIds, folder.id]
                                  : currentFolderIds.filter(
                                      (id) => id !== folder.id
                                    );
                                updateEntityFilters(
                                  SearchableEntityType.REPOSITORY_CASE,
                                  {
                                    folderIds: newFolderIds,
                                  }
                                );
                              }}
                            />
                            <label
                              htmlFor={`folder-${folder.id}`}
                              className="text-sm font-medium leading-none flex items-center gap-1 min-w-0"
                            >
                              <span className="truncate">{folder.name}</span>
                              {(() => {
                                const bucket =
                                  facetCounts?.folders?.buckets.find(
                                    (b) => b.key === folder.id.toString()
                                  );
                                return bucket ? (
                                  <span className="text-muted-foreground shrink-0">
                                    {`(${bucket.doc_count})`}
                                  </span>
                                ) : null;
                              })()}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Templates */}
                  {templates && templates.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <LayoutTemplate className="h-4 w-4" />
                        {t("search.filters.templates")}
                      </Label>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {filterItems(templates, "templateName").map(
                          (template) => (
                            <div
                              key={template.id}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={`template-${template.id}`}
                                checked={
                                  localFilters.repositoryCase?.templateIds?.includes(
                                    template.id
                                  ) || false
                                }
                                onCheckedChange={(checked) => {
                                  const currentTemplateIds =
                                    localFilters.repositoryCase?.templateIds ||
                                    [];
                                  const newTemplateIds = checked
                                    ? [...currentTemplateIds, template.id]
                                    : currentTemplateIds.filter(
                                        (id) => id !== template.id
                                      );
                                  updateEntityFilters(
                                    SearchableEntityType.REPOSITORY_CASE,
                                    {
                                      templateIds: newTemplateIds,
                                    }
                                  );
                                }}
                              />
                              <label
                                htmlFor={`template-${template.id}`}
                                className="text-sm font-medium leading-none flex items-center gap-1 min-w-0"
                              >
                                <span className="truncate">
                                  {template.templateName}
                                </span>
                                {(() => {
                                  const bucket =
                                    facetCounts?.templates?.buckets.find(
                                      (b) => b.key === template.id.toString()
                                    );
                                  return bucket ? (
                                    <span className="text-muted-foreground shrink-0">
                                      {`(${bucket.doc_count})`}
                                    </span>
                                  ) : null;
                                })()}
                              </label>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Automation Status */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Bot className="h-4 w-4" />
                      {t("search.filters.automationStatus")}
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
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Timer className="h-4 w-4" />
                      {t("search.filters.estimateRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={
                            localFilters.repositoryCase?.estimateRange?.min ||
                            ""
                          }
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                          value={
                            localFilters.repositoryCase?.estimateRange?.max ||
                            ""
                          }
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                    <Label className="text-sm font-medium">
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
                    {t("search.entityTypes.testRun")}
                  </h4>

                  {/* Test Run Type */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
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
                        <SelectValue
                          placeholder={t("search.filters.allTypes")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">
                          {t("search.filters.allTypes")}
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
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Combine className="h-4 w-4" />
                        {t("search.filters.configurations")}
                      </Label>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {filterItems(configurations).map((config) => (
                          <div
                            key={config.id}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={`config-${config.id}`}
                              checked={
                                localFilters.testRun?.configurationIds?.includes(
                                  config.id
                                ) || false
                              }
                              onCheckedChange={(checked) => {
                                const currentConfigIds =
                                  localFilters.testRun?.configurationIds || [];
                                const newConfigIds = checked
                                  ? [...currentConfigIds, config.id]
                                  : currentConfigIds.filter(
                                      (id) => id !== config.id
                                    );
                                updateEntityFilters(
                                  SearchableEntityType.TEST_RUN,
                                  {
                                    configurationIds: newConfigIds,
                                  }
                                );
                              }}
                            />
                            <label
                              htmlFor={`config-${config.id}`}
                              className="text-sm font-medium leading-none flex items-center gap-1 min-w-0"
                            >
                              <span className="truncate">{config.name}</span>
                              {(() => {
                                const bucket =
                                  facetCounts?.configurations?.buckets.find(
                                    (b) => b.key === config.id.toString()
                                  );
                                return bucket ? (
                                  <span className="text-muted-foreground shrink-0">
                                    {`(${bucket.doc_count})`}
                                  </span>
                                ) : null;
                              })()}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Milestones */}
                  {milestones && milestones.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Milestone className="h-4 w-4" />
                        {t("search.filters.milestones")}
                      </Label>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {filterItems(milestones).map((milestone) => (
                          <div
                            key={milestone.id}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={`milestone-${milestone.id}`}
                              checked={
                                localFilters.testRun?.milestoneIds?.includes(
                                  milestone.id
                                ) || false
                              }
                              onCheckedChange={(checked) => {
                                const currentMilestoneIds =
                                  localFilters.testRun?.milestoneIds || [];
                                const newMilestoneIds = checked
                                  ? [...currentMilestoneIds, milestone.id]
                                  : currentMilestoneIds.filter(
                                      (id) => id !== milestone.id
                                    );
                                updateEntityFilters(
                                  SearchableEntityType.TEST_RUN,
                                  {
                                    milestoneIds: newMilestoneIds,
                                  }
                                );
                              }}
                            />
                            <label
                              htmlFor={`milestone-${milestone.id}`}
                              className="text-sm font-medium leading-none flex items-center gap-1 min-w-0"
                            >
                              <span className="truncate">{milestone.name}</span>
                              {(() => {
                                const bucket =
                                  facetCounts?.milestones?.buckets.find(
                                    (b) => b.key === milestone.id.toString()
                                  );
                                return bucket ? (
                                  <span className="text-muted-foreground shrink-0">
                                    {`(${bucket.doc_count})`}
                                  </span>
                                ) : null;
                              })()}
                            </label>
                          </div>
                        ))}
                      </div>
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
                      className="flex items-center gap-2"
                    >
                      <CheckCircle className="h-4 w-4" />
                      {t("search.filters.completedOnly")}
                    </Label>
                  </div>

                  {/* Elapsed Time Range */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {t("search.filters.elapsedRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={localFilters.testRun?.elapsedRange?.min || ""}
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                          value={localFilters.testRun?.elapsedRange?.max || ""}
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                    {t("search.entityTypes.session")}
                  </h4>

                  {/* Session Templates */}
                  {templates && templates.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <LayoutTemplate className="h-4 w-4" />
                        {t("search.filters.templates")}
                      </Label>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {filterItems(templates, "templateName").map(
                          (template) => (
                            <div
                              key={template.id}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={`session-template-${template.id}`}
                                checked={
                                  localFilters.session?.templateIds?.includes(
                                    template.id
                                  ) || false
                                }
                                onCheckedChange={(checked) => {
                                  const currentTemplateIds =
                                    localFilters.session?.templateIds || [];
                                  const newTemplateIds = checked
                                    ? [...currentTemplateIds, template.id]
                                    : currentTemplateIds.filter(
                                        (id) => id !== template.id
                                      );
                                  updateEntityFilters(
                                    SearchableEntityType.SESSION,
                                    {
                                      templateIds: newTemplateIds,
                                    }
                                  );
                                }}
                              />
                              <label
                                htmlFor={`session-template-${template.id}`}
                                className="text-sm font-medium leading-none flex items-center gap-1 min-w-0"
                              >
                                <span className="truncate">
                                  {template.templateName}
                                </span>
                                {(() => {
                                  const bucket =
                                    facetCounts?.templates?.buckets.find(
                                      (b) => b.key === template.id.toString()
                                    );
                                  return bucket ? (
                                    <span className="text-muted-foreground shrink-0">
                                      {`(${bucket.doc_count})`}
                                    </span>
                                  ) : null;
                                })()}
                              </label>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Assigned To */}
                  {users && users.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <UserCheck className="h-4 w-4" />
                        {t("search.filters.assignedTo")}
                      </Label>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {filterItems(users).map((user) => (
                          <div
                            key={user.id}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={`assigned-${user.id}`}
                              checked={
                                localFilters.session?.assignedToIds?.includes(
                                  user.id
                                ) || false
                              }
                              onCheckedChange={(checked) => {
                                const currentAssignedIds =
                                  localFilters.session?.assignedToIds || [];
                                const newAssignedIds = checked
                                  ? [...currentAssignedIds, user.id]
                                  : currentAssignedIds.filter(
                                      (id) => id !== user.id
                                    );
                                updateEntityFilters(
                                  SearchableEntityType.SESSION,
                                  {
                                    assignedToIds: newAssignedIds,
                                  }
                                );
                              }}
                            />
                            <label
                              htmlFor={`assigned-${user.id}`}
                              className="text-sm font-medium leading-none flex items-center gap-1 min-w-0"
                            >
                              <span className="truncate">{user.name}</span>
                              {(() => {
                                const bucket =
                                  facetCounts?.assignedTo?.buckets.find(
                                    (b) => b.key === user.id
                                  );
                                return bucket ? (
                                  <span className="text-muted-foreground shrink-0">
                                    {`(${bucket.doc_count})`}
                                  </span>
                                ) : null;
                              })()}
                            </label>
                          </div>
                        ))}
                      </div>
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
                      className="flex items-center gap-2"
                    >
                      <CheckCircle className="h-4 w-4" />
                      {t("search.filters.completedOnly")}
                    </Label>
                  </div>

                  {/* Session Estimate Range */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Timer className="h-4 w-4" />
                      {t("search.filters.estimateRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={localFilters.session?.estimateRange?.min || ""}
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                          value={localFilters.session?.estimateRange?.max || ""}
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {t("search.filters.elapsedRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          {t("search.filters.minValue")}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          min="0"
                          value={localFilters.session?.elapsedRange?.min || ""}
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                          value={localFilters.session?.elapsedRange?.max || ""}
                          onChange={(e) => {
                            const value = e.target.value
                              ? parseInt(e.target.value)
                              : undefined;
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
                    {t("search.entityTypes.issue")}
                  </h4>

                  {/* Has External ID */}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="has-external-id"
                      checked={localFilters.issue?.hasExternalId === true}
                      onCheckedChange={(checked) => {
                        updateEntityFilters(SearchableEntityType.ISSUE, {
                          hasExternalId: checked ? true : undefined,
                        });
                      }}
                    />
                    <Label
                      htmlFor="has-external-id"
                      className="flex items-center gap-2"
                    >
                      <Hash className="h-4 w-4" />
                      {t("search.filters.hasExternalId")}
                    </Label>
                  </div>
                </div>
              )}

              {/* Milestone Filters */}
              {entityTypes.includes(SearchableEntityType.MILESTONE) && (
                <div className="space-y-4 p-4 bg-muted rounded-lg border border-border/50 max-w-full overflow-x-hidden">
                  <h4 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">
                    {t("search.entityTypes.milestone")}
                  </h4>

                  {/* Has Parent */}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="has-parent"
                      checked={localFilters.milestone?.hasParent === true}
                      onCheckedChange={(checked) => {
                        updateEntityFilters(SearchableEntityType.MILESTONE, {
                          hasParent: checked ? true : undefined,
                        });
                      }}
                    />
                    <Label
                      htmlFor="has-parent"
                      className="flex items-center gap-2"
                    >
                      <GitBranch className="h-4 w-4" />
                      {t("search.filters.hasParent")}
                    </Label>
                  </div>

                  {/* Due Date Range */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <CalendarIcon2 className="h-4 w-4" />
                      {t("search.filters.dueDateRange")}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "justify-start text-left font-normal min-w-0 w-full",
                              !localFilters.milestone?.dueDateRange?.from &&
                                "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">
                              {localFilters.milestone?.dueDateRange?.from
                                ? format(
                                    localFilters.milestone.dueDateRange.from,
                                    "PP"
                                  )
                                : t("search.filters.from")}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={
                              localFilters.milestone?.dueDateRange?.from
                            }
                            onSelect={(date) => {
                              updateEntityFilters(
                                SearchableEntityType.MILESTONE,
                                {
                                  dueDateRange: {
                                    ...localFilters.milestone?.dueDateRange,
                                    from: date,
                                  },
                                }
                              );
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
                              "justify-start text-left font-normal min-w-0 w-full",
                              !localFilters.milestone?.dueDateRange?.to &&
                                "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">
                              {localFilters.milestone?.dueDateRange?.to
                                ? format(
                                    localFilters.milestone.dueDateRange.to,
                                    "PP"
                                  )
                                : t("search.filters.to")}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={localFilters.milestone?.dueDateRange?.to}
                            onSelect={(date) => {
                              updateEntityFilters(
                                SearchableEntityType.MILESTONE,
                                {
                                  dueDateRange: {
                                    ...localFilters.milestone?.dueDateRange,
                                    to: date,
                                  },
                                }
                              );
                            }}
                            autoFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

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
                      className="flex items-center gap-2"
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
            {t("search.filters.clearAll")}
          </Button>
        </div>
      )}
    </div>
  );
}

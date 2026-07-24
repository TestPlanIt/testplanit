"use client";

import { ProjectDropdownMenu } from "@/components/ProjectDropdownMenu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApplicationArea } from "~/zenstack/models";
import {
  BookText as DocumentationIcon,
  Bug as IssuesIcon,
  ChartNoAxesCombined,
  Compass as SessionsIcon,
  FolderKanban,
  Home,
  Layers,
  ListTree as RepositoryIcon,
  Milestone,
  PlayCircle as RunsIcon,
  Plug,
  ScrollText,
  Settings,
  Settings2,
  Share2,
  ShieldCheck,
  Sparkles,
  SquareStack,
  Tags as TagsIcon,
  Webhook,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { Link, usePathname } from "~/lib/navigation";
import { cn } from "~/utils";

type MenuSection = "project" | "management" | "settings";

type MenuOption = {
  icon: React.ElementType;
  label: string;
  path: string;
  id?: string;
  section: MenuSection;
};

const sectionOrder: MenuSection[] = ["project", "management", "settings"];

const sectionIcons: Record<MenuSection, React.ElementType> = {
  project: Home,
  management: FolderKanban,
  settings: Settings,
};

interface ProjectMenuProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function MenuLink({
  option,
  projectId,
  isActive,
  isCollapsed,
  menuButtonClass,
}: {
  option: MenuOption;
  projectId: string | string[];
  isActive: boolean;
  isCollapsed: boolean;
  menuButtonClass: string;
}) {
  const IconComponent = option.icon;
  const searchParams = useSearchParams();
  const basePath =
    option.path === "shared-steps"
      ? `/projects/shared-steps/${projectId}`
      : option.path === "reports"
        ? `/projects/reports/${projectId}`
        : option.path.startsWith("settings/")
          ? `/projects/settings/${projectId}/${option.path.split("/")[1]}`
          : `/projects/${option.path}/${projectId}`;
  const href =
    isActive && searchParams.size > 0
      ? `${basePath}?${searchParams.toString()}`
      : basePath;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          id={option.id}
          href={href}
          className={cn(
            buttonVariants({ variant: "ghost" }),
            menuButtonClass,
            "flex items-center py-2 md:py-0 no-underline",
            isActive
              ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
              : "hover:bg-primary/10 hover:text-primary"
          )}
        >
          <IconComponent className="size-5 shrink-0" />
          <span
            className={`hidden md:inline-block ${isActive ? "font-bold" : ""} ${
              isCollapsed
                ? "md:max-w-0 md:opacity-0 md:overflow-hidden"
                : "md:max-w-[200px] md:opacity-100"
            } md:whitespace-nowrap md:transition-all md:duration-500`}
          >
            {option.label}
          </span>
        </Link>
      </TooltipTrigger>
      {isCollapsed && (
        <TooltipContent side="right">{option.label}</TooltipContent>
      )}
    </Tooltip>
  );
}

export default function ProjectsMenu({
  isCollapsed,
  onToggleCollapse: _onToggleCollapse,
}: ProjectMenuProps) {
  const { projectId } = useParams();
  const pathname = usePathname();
  const page = pathname.split("/")[2];
  const settingsSubPage =
    page === "settings" ? pathname.split("/")[4] : undefined;
  const menuButtonClass = "w-full rounded-none justify-start shadow-none";
  const shouldRenderMenu = projectId && !isNaN(Number(projectId));
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session } = useSession();

  // Permission check for Shared Steps
  const safeProjectId = projectId ? String(projectId) : "";
  const { permissions: sharedStepsPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.SharedSteps
  );
  const canSeeSharedSteps =
    sharedStepsPerms &&
    (sharedStepsPerms.canAddEdit || sharedStepsPerms.canDelete);

  // Issues are accessible to all users - no permission check needed

  // Permission check for Reporting
  const { permissions: reportingPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.Reporting
  );
  const canSeeReports =
    reportingPerms && (reportingPerms.canAddEdit || reportingPerms.canDelete);

  // Project audit log is restricted to system ADMINs and PROJECTADMINs.
  const canSeeAuditLogs =
    session?.user?.access === "ADMIN" ||
    session?.user?.access === "PROJECTADMIN";

  // Check if user can see Settings
  // Settings should be visible to:
  // 1. System ADMIN users (always have access to all projects)
  // 2. System PROJECTADMIN users (have access to settings for any project they can access)
  // 3. Users with Settings area permissions (Project Admin role)
  const { permissions: settingsPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.Settings
  );
  const canSeeSettings =
    session?.user?.access === "ADMIN" || // System admins always have access
    session?.user?.access === "PROJECTADMIN" || // PROJECTADMIN users always see settings for accessible projects
    (settingsPerms && settingsPerms.canAddEdit); // Has Settings permissions

  const menuOptions: MenuOption[] = [
    // Project
    {
      icon: Home,
      label: t("projects.overview.title"),
      path: "overview",
      id: "overview-link",
      section: "project",
    },
    {
      icon: DocumentationIcon,
      label: t("common.fields.documentation"),
      path: "documentation",
      id: "documentation-link",
      section: "project",
    },
    {
      icon: Milestone,
      label: t("common.fields.milestones"),
      path: "milestones",
      id: "milestones-link",
      section: "project",
    },
    // Management
    {
      icon: RepositoryIcon,
      label: t("navigation.projects.menu.repository"),
      path: "repository",
      id: "test-cases-link",
      section: "management",
    },
    ...(canSeeSharedSteps
      ? [
          {
            icon: Layers,
            label: t("enums.ApplicationArea.SharedSteps"),
            path: "shared-steps",
            id: "shared-steps-link",
            section: "management" as MenuSection,
          },
        ]
      : []),
    {
      icon: RunsIcon,
      label: t("navigation.projects.menu.runs"),
      path: "runs",
      id: "test-runs-link",
      section: "management",
    },
    {
      icon: SessionsIcon,
      label: t("common.fields.sessions"),
      path: "sessions",
      id: "exploratory-link",
      section: "management",
    },
    {
      icon: TagsIcon,
      label: tCommon("fields.tags"),
      path: "tags",
      id: "project-tags-link",
      section: "management",
    },
    {
      icon: IssuesIcon,
      label: t("common.fields.issues"),
      path: "issues",
      id: "project-issues-link",
      section: "management",
    },
    ...(canSeeReports
      ? [
          {
            icon: ChartNoAxesCombined,
            label: t("admin.menu.reports"),
            path: "reports",
            id: "reports-link",
            section: "management" as MenuSection,
          },
        ]
      : []),
    ...(canSeeAuditLogs
      ? [
          {
            icon: ShieldCheck,
            label: t("admin.menu.auditLogs"),
            path: "audit-logs",
            id: "audit-logs-link",
            section: "management" as MenuSection,
          },
        ]
      : []),
    // Settings
    ...(canSeeSettings
      ? [
          {
            icon: Plug,
            label: t("admin.menu.integrations"),
            path: "settings/integrations",
            id: "settings-integrations-link",
            section: "settings" as MenuSection,
          },
          {
            icon: Webhook,
            label: t("admin.menu.webhooks"),
            path: "settings/webhooks",
            id: "settings-webhooks-link",
            section: "settings" as MenuSection,
          },
          {
            icon: Sparkles,
            label: t("admin.menu.llm"),
            path: "settings/ai-models",
            id: "settings-ai-models-link",
            section: "settings" as MenuSection,
          },
          {
            icon: ScrollText,
            label: t("admin.menu.quickScript"),
            path: "settings/quickscript",
            id: "settings-quickscript-link",
            section: "settings" as MenuSection,
          },
          {
            icon: SquareStack,
            label: t("admin.menu.testCaseParameters"),
            path: "settings/parameters",
            id: "settings-test-case-parameters-link",
            section: "settings" as MenuSection,
          },
          {
            icon: Settings2,
            label: t("admin.menu.advanced"),
            path: "settings/advanced",
            id: "settings-advanced-link",
            section: "settings" as MenuSection,
          },
          {
            icon: Share2,
            label: t("admin.menu.shares"),
            path: "settings/shares",
            id: "settings-shares-link",
            section: "settings" as MenuSection,
          },
        ]
      : []),
  ];

  const sectionLabels: Record<MenuSection, string> = {
    project: t("common.fields.project"),
    management: t("navigation.projects.sections.management"),
    settings: t("common.tabs.settings"),
  };

  const groups = sectionOrder
    .map((sectionKey) => ({
      key: sectionKey,
      items: menuOptions.filter((opt) => opt.section === sectionKey),
    }))
    .filter((group) => group.items.length > 0);

  // Stable key for tracking which sections exist (used as useEffect dependency)
  const groupKeys = groups.map((g) => g.key).join(",");

  const [openSections, setOpenSections] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("projectMenu:openSections");
        // First visit: no stored value → expand all sections so users discover the full menu
        return stored ? (JSON.parse(stored) as string[]) : [...sectionOrder];
      } catch {
        return [...sectionOrder];
      }
    }
    return [...sectionOrder];
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "projectMenu:openSections",
        JSON.stringify(openSections)
      );
    } catch {
      // ignore storage errors
    }
  }, [openSections]);

  useEffect(() => {
    // Ensure the section containing the active page is open.
    // Include `groupKeys` in deps so that when permissions load (e.g., canSeeSettings
    // becomes true after session loads), the newly-visible section auto-expands.
    const activePage =
      page === "settings" ? `settings/${settingsSubPage}` : page;
    const activeSection = groups.find((group) =>
      group.items.some((item) => item.path === activePage)
    );
    if (activeSection && !openSections.includes(activeSection.key)) {
      setOpenSections((prev) => [...prev, activeSection.key]);
    }
  }, [page, settingsSubPage, groupKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card
      shadow="none"
      className="sticky top-0 z-10 rounded-none border-none h-full shadow-none"
    >
      <CardContent className="bg-primary-foreground h-full p-0 flex flex-col">
        <CardHeader
          className={`${isCollapsed ? "mb-0 -ms-6" : "mb-0 md:-mb-6"}`}
        >
          <CardTitle>
            <ProjectDropdownMenu isCollapsed={isCollapsed} />
          </CardTitle>
        </CardHeader>
        {shouldRenderMenu && (
          <div className="grow overflow-y-auto">
            <Accordion
              type="multiple"
              value={openSections}
              onValueChange={setOpenSections}
              className="w-full"
            >
              {groups.map((group) => (
                <AccordionItem
                  key={group.key}
                  value={group.key}
                  className="border-0 rounded-none overflow-visible mb-0"
                  data-testid={`project-menu-section-${group.key}`}
                >
                  <AccordionTrigger
                    className={cn(
                      "ms-3 py-2 mt-2 px-0 bg-transparent hover:bg-transparent uppercase text-xs hover:no-underline flex border-b-2 border-primary/40 md:border-b-0",
                      isCollapsed &&
                        "md:max-h-0 md:opacity-0 md:overflow-hidden md:p-0 md:m-0"
                    )}
                  >
                    <span className="md:hidden">
                      {(() => {
                        const Icon = sectionIcons[group.key];
                        return (
                          <Icon className="w-5 h-5 shrink-0 stroke-primary" />
                        );
                      })()}
                    </span>
                    <span className="hidden md:inline">
                      {sectionLabels[group.key]}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-0">
                    {group.items.map((option) => {
                      const isActive = option.path.startsWith("settings/")
                        ? page === "settings" &&
                          settingsSubPage === option.path.split("/")[1]
                        : page === option.path;

                      return (
                        <MenuLink
                          key={option.path}
                          option={option}
                          projectId={projectId!}
                          isActive={isActive}
                          isCollapsed={isCollapsed}
                          menuButtonClass={menuButtonClass}
                        />
                      );
                    })}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

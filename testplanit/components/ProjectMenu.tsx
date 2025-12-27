"use client";

import { usePathname } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectDropdownMenu } from "@/components/ProjectDropdownMenu";
import { Link } from "~/lib/navigation";
import {
  Home,
  Milestone,
  BookText as DocumentationIcon,
  ListTree as RepositoryIcon,
  PlayCircle as RunsIcon,
  Tags as TagsIcon,
  Compass as SessionsIcon,
  Bug as IssuesIcon,
  Layers,
  ChartNoAxesCombined,
  Settings,
} from "lucide-react";
import { cn } from "~/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import { useSession } from "next-auth/react";

type MenuOption = {
  icon?: React.ElementType;
  label: string;
  path?: string;
};

interface ProjectMenuProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function ProjectsMenu({
  isCollapsed,
  onToggleCollapse,
}: ProjectMenuProps) {
  const { projectId } = useParams();
  const page = usePathname().split("/")[2];
  const menuButtonClass = "w-full rounded-none justify-start shadow-none";
  const shouldRenderMenu = projectId && !isNaN(Number(projectId));
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session } = useSession();

  // Permission check for Shared Steps
  const safeProjectId = projectId ? String(projectId) : "";
  const { permissions: sharedStepsPerms, isLoading: sharedStepsPermsLoading } =
    useProjectPermissions(safeProjectId, ApplicationArea.SharedSteps);
  const canSeeSharedSteps =
    sharedStepsPerms &&
    (sharedStepsPerms.canAddEdit || sharedStepsPerms.canDelete);

  // Issues are accessible to all users - no permission check needed

  // Permission check for Reporting
  const { permissions: reportingPerms, isLoading: reportingPermsLoading } =
    useProjectPermissions(safeProjectId, ApplicationArea.Reporting);
  const canSeeReports =
    reportingPerms && (reportingPerms.canAddEdit || reportingPerms.canDelete);

  // Check if user can see Settings
  // Settings should be visible to:
  // 1. System ADMIN users (always have access to all projects)
  // 2. System PROJECTADMIN users (have access to settings for any project they can access)
  // 3. Users with Settings area permissions (Project Admin role)
  const { permissions: settingsPerms, isLoading: settingsPermsLoading } =
    useProjectPermissions(safeProjectId, ApplicationArea.Settings);
  const canSeeSettings =
    session?.user?.access === "ADMIN" || // System admins always have access
    session?.user?.access === "PROJECTADMIN" || // PROJECTADMIN users always see settings for accessible projects
    (settingsPerms && settingsPerms.canAddEdit); // Has Settings permissions

  const menuOptions: MenuOption[] = [
    { label: t("common.fields.project") },
    {
      icon: Home,
      label: t("projects.overview.title"),
      path: "overview",
    },
    {
      icon: DocumentationIcon,
      label: t("common.fields.documentation"),
      path: "documentation",
    },
    {
      icon: Milestone,
      label: t("common.fields.milestones"),
      path: "milestones",
    },
    { label: t("navigation.projects.sections.management") },
    {
      icon: RepositoryIcon,
      label: t("navigation.projects.menu.repository"),
      path: "repository",
    },
    ...(canSeeSharedSteps
      ? [
          {
            icon: Layers,
            label: t("enums.ApplicationArea.SharedSteps"),
            path: "shared-steps",
          },
        ]
      : []),
    {
      icon: RunsIcon,
      label: t("navigation.projects.menu.runs"),
      path: "runs",
    },
    {
      icon: SessionsIcon,
      label: t("common.fields.sessions"),
      path: "sessions",
    },
    {
      icon: TagsIcon,
      label: tCommon("fields.tags"),
      path: "tags",
    },
    {
      icon: IssuesIcon,
      label: t("common.fields.issues"),
      path: "issues",
    },
    ...(canSeeReports
      ? [
          {
            icon: ChartNoAxesCombined,
            label: t("admin.menu.reports"),
            path: "reports",
          },
        ]
      : []),
    ...(canSeeSettings
      ? [
          {
            icon: Settings,
            label: t("common.tabs.settings"),
            path: "settings",
          },
        ]
      : []),
  ];

  return (
    <Card
      shadow="none"
      className="sticky top-0 z-10 rounded-none border-none h-full shadow-none"
    >
      <CardContent className="bg-primary-foreground h-full p-0">
        <CardHeader
          className={`${isCollapsed ? "mb-0 -ml-6" : "mb-0 md:-mb-6"}`}
        >
          <CardTitle>
            <ProjectDropdownMenu isCollapsed={isCollapsed} />
          </CardTitle>
        </CardHeader>
        {shouldRenderMenu && (
          <div>
            {(() => {
              const sections: { header?: MenuOption; items: MenuOption[] }[] =
                [];
              let currentSection: { header?: MenuOption; items: MenuOption[] } =
                { items: [] };

              menuOptions.forEach((option) => {
                if (!option.path) {
                  // This is a section header
                  if (currentSection.items.length > 0) {
                    sections.push(currentSection);
                  }
                  currentSection = { header: option, items: [] };
                } else {
                  // This is a menu item
                  currentSection.items.push(option);
                }
              });

              // Push the last section
              if (currentSection.items.length > 0) {
                sections.push(currentSection);
              }

              return sections.map((section, sectionIndex) => {
                const sectionId =
                  section.header?.label === t("common.fields.project")
                    ? "project-section"
                    : section.header?.label ===
                        t("navigation.projects.sections.management")
                      ? "management-section"
                      : `section-${sectionIndex}`;

                return (
                  <div key={sectionId} id={sectionId} className="menu-section">
                    {section.header && (
                      <div
                        className={`ml-1 mb-2 uppercase text-xs ${isCollapsed ? "hidden" : "hidden md:inline"}`}
                      >
                        {section.header.label}
                      </div>
                    )}
                    {section.items.map((option: MenuOption) => {
                      const isActive = page === `${option.path}`;
                      const IconComponent = option.icon;

                      return (
                        <TooltipProvider key={option.path}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                id={
                                  option.path === "repository"
                                    ? "test-cases-link"
                                    : option.path === "runs"
                                      ? "test-runs-link"
                                      : option.path === "sessions"
                                        ? "exploratory-link"
                                        : option.path === "reports"
                                          ? "reports-link"
                                          : option.path === "settings"
                                            ? "settings-link"
                                            : undefined
                                }
                                href={
                                  option.path === "shared-steps"
                                    ? `/projects/shared-steps/${projectId}`
                                    : option.path === "reports"
                                      ? `/projects/reports/${projectId}`
                                      : option.path === "settings"
                                        ? `/projects/settings/${projectId}`
                                        : `/projects/${option.path}/${projectId}`
                                }
                                className={cn(
                                  buttonVariants({ variant: "ghost" }),
                                  menuButtonClass,
                                  "flex items-center py-2 md:py-0 no-underline",
                                  isActive
                                    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                                    : "hover:bg-primary/10 hover:text-primary"
                                )}
                              >
                                {IconComponent && (
                                  <IconComponent className="min-w-6 min-h-6" />
                                )}
                                <span
                                  className={`${isCollapsed ? "hidden" : "hidden md:inline"} ${isActive ? "font-bold" : ""}`}
                                >
                                  {option.label}
                                </span>
                              </Link>
                            </TooltipTrigger>
                            {isCollapsed && (
                              <TooltipContent side="right">
                                {option.label}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplicationArea } from "@prisma/client";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import {
  CardComponentProps,
  NavigationAdapter, NextStep,
  NextStepProvider, Tour, useNextStep
} from "nextstepjs";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  useFindFirstUserPreferences,
  useFindManyProjects,
  useUpdateUserPreferences
} from "~/lib/hooks";
import { usePathname, useRouter } from "~/lib/navigation";

// Custom tour card component that respects Tailwind theme
function TourCard({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
  arrow,
}: CardComponentProps) {
  const t = useTranslations();

  return (
    <div className="relative">
      <Card className="w-80 shadow-lg border-border bg-card/70 text-card-foreground backdrop-blur-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold text-primary">
              {step.title}
            </CardTitle>
            {skipTour && (
              <Button
                variant="ghost"
                size="sm"
                onClick={skipTour}
                className="h-8 w-8 p-0 hover:bg-muted"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">
                  {t("common.ui.onboarding.skipTour")}
                </span>
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground leading-relaxed">
            {step.content}
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex gap-1">
              {currentStep > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={prevStep}
                  className="text-xs"
                >
                  <ChevronLeft className="h-3 w-3" />
                  {t("common.actions.previous") || "Previous"}
                </Button>
              )}

              <Button size="sm" onClick={nextStep} className="text-xs">
                {currentStep === totalSteps - 1
                  ? t("common.actions.finish") || "Finish"
                  : t("common.actions.next") || "Next"}
                {currentStep !== totalSteps - 1 && (
                  <ChevronRight className="h-3 w-3" />
                )}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              {currentStep + 1} / {totalSteps}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="text-primary">{arrow}</div>
    </div>
  );
}

const createTourSteps = (
  t: any,
  projectId?: string,
  options?: {
    canSeeSharedSteps?: boolean;
    canSeeReports?: boolean;
    canSeeSettings?: boolean;
  }
): Tour[] => [
  {
    tour: "mainTour",
    steps: [
      {
        icon: null,
        title: t("help.tour.mainTour.welcome.title"),
        content: t("help.tour.mainTour.welcome.content"),
        selector: "#header-logo",
        side: "bottom-left",
        showControls: true,
        showSkip: true,
        pointerPadding: 20,
      },
      {
        icon: null,
        title: t("common.fields.projects"),
        content: t("help.tour.mainTour.projects.content"),
        selector: "#projects-link",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 20,
      },
      {
        icon: null,
        title: t("help.tour.mainTour.globalFeatures.title"),
        content: t("help.tour.mainTour.globalFeatures.content"),
        selector: "#global-features",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 20,
      },
      {
        icon: null,
        title: t("search.title"),
        content: t("help.tour.mainTour.search.content"),
        selector: '[data-testid="global-search-trigger"]',
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 5,
      },
      {
        icon: null,
        title: t("help.tour.mainTour.help.title"),
        content: t("help.tour.mainTour.help.content"),
        selector: '[data-testid="help-menu-button"]',
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 5,
      },
      {
        icon: null,
        title: t("common.fields.notificationMode"),
        content: t("help.tour.mainTour.notifications.content"),
        selector: '[data-testid="notification-bell-button"]',
        side: "bottom-right",
        showControls: true,
        showSkip: true,
        pointerPadding: 5,
      },
      {
        icon: null,
        title: t("help.tour.mainTour.account.title"),
        content: t("help.tour.mainTour.account.content"),
        selector: '[data-testid="user-menu-trigger"]',
        side: "bottom-right",
        showControls: true,
        showSkip: true,
        pointerPadding: 5,
        nextRoute: "/",
      },
      {
        icon: null,
        title: t("home.dashboard.yourAssignments"),
        content: t("help.tour.mainTour.assignments.content"),
        selector: "#dashboard-header",
        side: "right",
        showControls: true,
        showSkip: false,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("common.fields.projects"),
        content: t("help.tour.mainTour.projects.content"),
        selector: "#your-projects-header",
        side: "left",
        showControls: true,
        showSkip: false,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.mainTour.project.title"),
        content: t("help.tour.mainTour.project.content"),
        selector: "#your-projects a",
        side: "left",
        showControls: true,
        showSkip: false,
        pointerPadding: 10,
      },
    ],
  },
  {
    tour: "projectTour",
    steps: (() => {
      // Build steps dynamically based on feature access
      const steps: Tour["steps"] = [
        // Project selector dropdown
        {
          icon: null,
          title: t("help.tour.projectTour.projectSelector.title"),
          content: t("help.tour.projectTour.projectSelector.content"),
          selector: "[data-testid='project-dropdown-trigger']",
          side: "bottom-left",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
        },
        // Project sections overview
        {
          icon: null,
          title: t("help.tour.projectTour.projectSections.title"),
          content: t("help.tour.projectTour.projectSections.content"),
          selector: "#project-section",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
        },
        // Repository
        {
          icon: null,
          title: t("repository.title"),
          content: t("help.tour.projectTour.repository.content"),
          selector: "#test-cases-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
        },
      ];

      // Shared Steps (conditional)
      if (options?.canSeeSharedSteps) {
        steps.push({
          icon: null,
          title: t("help.tour.projectTour.sharedSteps.title"),
          content: t("help.tour.projectTour.sharedSteps.content"),
          selector: "#shared-steps-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
        });
      }

      // Test Runs
      steps.push({
        icon: null,
        title: t("navigation.projects.menu.runs"),
        content: t("help.tour.projectTour.testRuns.content"),
        selector: "#test-runs-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      });

      // Sessions
      steps.push({
        icon: null,
        title: t("help.tour.projectTour.sessions.title"),
        content: t("help.tour.projectTour.sessions.content"),
        selector: "#exploratory-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      });

      // Tags
      steps.push({
        icon: null,
        title: t("help.tour.projectTour.tags.title"),
        content: t("help.tour.projectTour.tags.content"),
        selector: "#project-tags-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      });

      // Issues
      steps.push({
        icon: null,
        title: t("help.tour.projectTour.issues.title"),
        content: t("help.tour.projectTour.issues.content"),
        selector: "#project-issues-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      });

      // Reports (conditional)
      if (options?.canSeeReports) {
        steps.push({
          icon: null,
          title: t("help.tour.projectTour.reports.title"),
          content: t("help.tour.projectTour.reports.content"),
          selector: "#reports-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
        });
      }

      // Settings (conditional)
      if (options?.canSeeSettings) {
        steps.push({
          icon: null,
          title: t("help.tour.projectTour.settings.title"),
          content: t("help.tour.projectTour.settings.content"),
          selector: "#settings-integrations-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
        });
      }

      // Mark last step
      steps[steps.length - 1].showSkip = false;

      // Add nextRoute for cross-page navigation between consecutive steps
      // Each step navigates to the page of the NEXT step's sidebar link
      const routeMap: Record<string, string> = {
        "#test-cases-link": "repository",
        "#shared-steps-link": "shared-steps",
        "#test-runs-link": "runs",
        "#exploratory-link": "sessions",
        "#project-tags-link": "tags",
        "#project-issues-link": "issues",
        "#reports-link": "reports",
        "#settings-integrations-link": "settings",
      };
      for (let i = 0; i < steps.length - 1; i++) {
        const nextSelector = steps[i + 1].selector;
        const nextPage = nextSelector ? routeMap[nextSelector] : undefined;
        if (nextPage && projectId) {
          if (nextSelector === "#settings-integrations-link") {
            steps[i].nextRoute = `/projects/settings/${projectId}/integrations`;
          } else {
            steps[i].nextRoute = `/projects/${nextPage}/${projectId}`;
          }
        }
      }

      return steps;
    })(),
  },
  {
    tour: "adminTour",
    steps: [
      {
        icon: null,
        title: t("help.tour.adminTour.welcome.title"),
        content: t("help.tour.adminTour.welcome.content"),
        selector: "[data-testid='admin-page-title']",
        side: "bottom-left",
        showControls: true,
        showSkip: true,
        pointerPadding: 20,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.projects.title"),
        content: t("help.tour.adminTour.projects.content"),
        selector: "#admin-menu-projects",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("common.labels.templates"),
        content: t("help.tour.adminTour.templatesAndFields.content"),
        selector: "#admin-menu-fields",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.workflows.title"),
        content: t("help.tour.adminTour.workflows.content"),
        selector: "#admin-menu-workflows",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.statuses.title"),
        content: t("help.tour.adminTour.statuses.content"),
        selector: "#admin-menu-statuses",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("common.fields.milestoneTypes"),
        content: t("help.tour.adminTour.milestones.content"),
        selector: "#admin-menu-milestones",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.configurations.title"),
        content: t("help.tour.adminTour.configurations.content"),
        selector: "#admin-menu-configurations",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.users.title"),
        content: t("help.tour.adminTour.users.content"),
        selector: "#admin-menu-users",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.groups.title"),
        content: t("help.tour.adminTour.groups.content"),
        selector: "#admin-menu-groups",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.roles.title"),
        content: t("help.tour.adminTour.roles.content"),
        selector: "#admin-menu-roles",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.tags.title"),
        content: t("help.tour.adminTour.tags.content"),
        selector: "#admin-menu-tags",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("navigation.admin.crossProjectReports"),
        content: t("help.tour.adminTour.reports.content"),
        selector: "#admin-menu-reports",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.notifications.title"),
        content: t("help.tour.adminTour.notifications.content"),
        selector: "#admin-menu-notifications",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.integrations.title"),
        content: t("help.tour.adminTour.integrations.content"),
        selector: "#admin-menu-integrations",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.llm.title"),
        content: t("help.tour.adminTour.llm.content"),
        selector: "#admin-menu-llm",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.sso.title"),
        content: t("help.tour.adminTour.sso.content"),
        selector: "#admin-menu-sso",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("admin.menu.appConfig"),
        content: t("help.tour.adminTour.appConfig.content"),
        selector: "#admin-menu-app-config",
        side: "top-left",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.adminTour.trash.title"),
        content: t("help.tour.adminTour.trash.content"),
        selector: "#admin-menu-trash",
        side: "top-left",
        showControls: true,
        showSkip: false,
        pointerPadding: 10,
      },
    ],
  },
  {
    tour: "demoProjectTour",
    steps: (() => {
      // Each step is tagged with the page it belongs to (_page) so that
      // cross-page nextRoute/prevRoute can be auto-generated below.
      type TaggedStep = Tour["steps"][number] & { _page?: string };
      const steps: TaggedStep[] = [
        // Project selector
        {
          icon: null,
          title: t("help.tour.demoProjectTour.projectSelector.title"),
          content: t("help.tour.demoProjectTour.projectSelector.content"),
          selector: "[data-testid='project-dropdown-trigger']",
          side: "bottom-left",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "overview",
        },
        // Overview — project dashboard
        {
          icon: null,
          title: t("help.tour.demoProjectTour.overview.title"),
          content: t("help.tour.demoProjectTour.overview.content"),
          selector: "#overview-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "overview",
        },
        // Documentation sidebar link
        {
          icon: null,
          title: t("help.tour.demoProjectTour.documentation.title"),
          content: t("help.tour.demoProjectTour.documentation.content"),
          selector: "#documentation-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "documentation",
        },
        // Documentation content
        {
          icon: null,
          title: t("help.tour.demoProjectTour.documentationContent.title"),
          content: t("help.tour.demoProjectTour.documentationContent.content"),
          selector: "#documentation-content",
          side: "bottom",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "documentation",
        },
        // Milestones sidebar link
        {
          icon: null,
          title: t("help.tour.demoProjectTour.milestones.title"),
          content: t("help.tour.demoProjectTour.milestones.content"),
          selector: "#milestones-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "milestones",
        },
        // Milestones page content
        {
          icon: null,
          title: t("help.tour.demoProjectTour.milestonesPage.title"),
          content: t("help.tour.demoProjectTour.milestonesPage.content"),
          selector: "#milestones-page-header",
          side: "bottom",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "milestones",
        },
        // Repository sidebar link
        {
          icon: null,
          title: t("help.tour.demoProjectTour.repository.title"),
          content: t("help.tour.demoProjectTour.repository.content"),
          selector: "#test-cases-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "repository",
        },
        // Repository folder panel
        {
          icon: null,
          title: t("help.tour.demoProjectTour.repositoryPanels.title"),
          content: t("help.tour.demoProjectTour.repositoryPanels.content"),
          selector: "[data-testid='repository-left-panel-header']",
          side: "bottom-right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "repository",
        },
        // Repository test cases table
        {
          icon: null,
          title: t("help.tour.demoProjectTour.repositoryCases.title"),
          content: t("help.tour.demoProjectTour.repositoryCases.content"),
          selector: "[data-testid='repository-right-panel-header']",
          side: "bottom-left",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "repository",
        },
      ];

      // Shared Steps (conditional)
      if (options?.canSeeSharedSteps) {
        steps.push(
          {
            icon: null,
            title: t("help.tour.demoProjectTour.sharedSteps.title"),
            content: t("help.tour.demoProjectTour.sharedSteps.content"),
            selector: "#shared-steps-link",
            side: "right",
            showControls: true,
            showSkip: true,
            pointerPadding: 10,
            _page: "shared-steps",
          },
          {
            icon: null,
            title: t("help.tour.demoProjectTour.sharedStepsPage.title"),
            content: t("help.tour.demoProjectTour.sharedStepsPage.content"),
            selector: "[data-testid^='shared-step-group-']",
            side: "bottom",
            showControls: true,
            showSkip: true,
            pointerPadding: 10,
            _page: "shared-steps",
          }
        );
      }

      // Test Runs
      steps.push(
        {
          icon: null,
          title: t("help.tour.demoProjectTour.testRuns.title"),
          content: t("help.tour.demoProjectTour.testRuns.content"),
          selector: "#test-runs-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "runs",
        },
        {
          icon: null,
          title: t("help.tour.demoProjectTour.testRunsPage.title"),
          content: t("help.tour.demoProjectTour.testRunsPage.content"),
          selector: "#test-runs-page-header",
          side: "bottom",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "runs",
        }
      );

      // Sessions
      steps.push(
        {
          icon: null,
          title: t("help.tour.demoProjectTour.sessions.title"),
          content: t("help.tour.demoProjectTour.sessions.content"),
          selector: "#exploratory-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "sessions",
        },
        {
          icon: null,
          title: t("help.tour.demoProjectTour.sessionsPage.title"),
          content: t("help.tour.demoProjectTour.sessionsPage.content"),
          selector: "#sessions-page-header",
          side: "bottom",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "sessions",
        }
      );

      // Tags
      steps.push(
        {
          icon: null,
          title: t("help.tour.demoProjectTour.tags.title"),
          content: t("help.tour.demoProjectTour.tags.content"),
          selector: "#project-tags-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "tags",
        },
        {
          icon: null,
          title: t("help.tour.demoProjectTour.tagsPage.title"),
          content: t("help.tour.demoProjectTour.tagsPage.content"),
          selector: "#tags-page-header",
          side: "bottom",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "tags",
        }
      );

      // Issues
      steps.push(
        {
          icon: null,
          title: t("help.tour.demoProjectTour.issues.title"),
          content: t("help.tour.demoProjectTour.issues.content"),
          selector: "#project-issues-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "issues",
        },
        {
          icon: null,
          title: t("help.tour.demoProjectTour.issuesPage.title"),
          content: t("help.tour.demoProjectTour.issuesPage.content"),
          selector: "#issues-page-header",
          side: "bottom",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "issues",
        }
      );

      // Reports (conditional)
      if (options?.canSeeReports) {
        steps.push({
          icon: null,
          title: t("help.tour.demoProjectTour.reports.title"),
          content: t("help.tour.demoProjectTour.reports.content"),
          selector: "#reports-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "reports",
        });
      }

      // Settings (conditional)
      if (options?.canSeeSettings) {
        steps.push({
          icon: null,
          title: t("help.tour.demoProjectTour.settings.title"),
          content: t("help.tour.demoProjectTour.settings.content"),
          selector: "#settings-integrations-link",
          side: "right",
          showControls: true,
          showSkip: true,
          pointerPadding: 10,
          _page: "settings/integrations",
        });
      }

      // Mark last step
      steps[steps.length - 1].showSkip = false;

      // Auto-generate nextRoute / prevRoute for cross-page transitions
      const pageToRoute = (page: string) =>
        page === "settings/integrations"
          ? `/projects/settings/${projectId}/integrations`
          : `/projects/${page}/${projectId}`;

      for (let i = 0; i < steps.length; i++) {
        // nextRoute: when the NEXT step is on a different page
        if (i < steps.length - 1 && steps[i]._page !== steps[i + 1]._page) {
          steps[i].nextRoute = projectId
            ? `${pageToRoute(steps[i + 1]._page!)}?tour=demoProjectTour&step=${i + 1}`
            : undefined;
        }
        // prevRoute: when the PREVIOUS step is on a different page
        if (i > 0 && steps[i]._page !== steps[i - 1]._page) {
          steps[i].prevRoute = projectId
            ? `${pageToRoute(steps[i - 1]._page!)}?tour=demoProjectTour&step=${i - 1}`
            : undefined;
        }
      }

      // Strip the _page metadata before returning
      return steps.map(({ _page, ...step }) => step);
    })(),
  },
];

// Custom navigation adapter that uses the i18n-aware router from ~/lib/navigation
// instead of next/navigation directly, which would navigate without the locale prefix
// and cause a full page reload via middleware redirect.
const useI18nNavigationAdapter = (): NavigationAdapter => {
  const router = useRouter();
  const pathname = usePathname();

  return {
    push: (path: string) => {
      router.push(path);
    },
    getCurrentPath: () => pathname || "/",
  };
};

interface NextStepOnboardingProps {
  children: React.ReactNode;
}

// Inner component that has access to NextStep context
function NextStepController() {
  const nextStepContext = useNextStep();
  const { startNextStep, setCurrentStep } = nextStepContext;

  useEffect(() => {
    // Expose the context functions globally
    (window as any).startOnboardingTour = (tourName: string = "mainTour") => {
      startNextStep(tourName);
    };

    // Also expose admin tour function for consistency
    (window as any).startAdminTour = (tourName: string = "adminTour") => {
      startNextStep(tourName);
    };

    // Expose setCurrentStep for cross-page tour restoration
    (window as any).__setTourStep = (step: number) => {
      setCurrentStep(step, 0);
    };

    return () => {
      delete (window as any).startOnboardingTour;
      delete (window as any).startAdminTour;
      delete (window as any).__setTourStep;
    };
  }, [startNextStep, setCurrentStep]);

  return null; // This component only manages the global function
}

export function NextStepOnboarding({ children }: NextStepOnboardingProps) {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations();
  const { data: session } = useSession();

  // Track if we're currently in an active tour to prevent restoration conflicts
  const activeTourRef = useRef<string | null>(null);
  const prevPathnameRef = useRef<string>(pathname);

  // Track pathname changes — don't clear activeTourRef here.
  // NextStep's MutationObserver handles cross-page step transitions natively.
  // Clearing would cause the restoration effect to re-start the tour,
  // causing a disappear/reappear flash.
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  // Get user preferences to check tour completion status
  const { data: userPreferences } = useFindFirstUserPreferences(
    {
      where: { userId: session?.user?.id || "" },
    },
    { enabled: !!session?.user?.id }
  );

  // Hook to update user preferences
  const { mutateAsync: updateUserPreferences } = useUpdateUserPreferences();

  // Find Demo Project (React Query deduplicates with Header's identical query)
  const { data: allProjects = [] } = useFindManyProjects({
    where: { isDeleted: false },
    orderBy: [{ isCompleted: "asc" as const }, { name: "asc" as const }],
    select: { id: true, name: true, iconUrl: true, isCompleted: true, isDeleted: true },
  });
  const demoProject = allProjects.find((p: any) => p.name === "Demo Project");

  // Get current projectId from URL params
  const projectId = params?.projectId as string;

  // Permission checks for conditional tour steps
  const safeProjectId = projectId || "";
  const { permissions: sharedStepsPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.SharedSteps
  );
  const canSeeSharedSteps = !!(
    sharedStepsPerms &&
    (sharedStepsPerms.canAddEdit || sharedStepsPerms.canDelete)
  );
  const { permissions: reportingPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.Reporting
  );
  const canSeeReports = !!(
    reportingPerms &&
    (reportingPerms.canAddEdit || reportingPerms.canDelete)
  );
  const { permissions: settingsPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.Settings
  );
  const canSeeSettings = !!(
    session?.user?.access === "ADMIN" ||
    session?.user?.access === "PROJECTADMIN" ||
    (settingsPerms && settingsPerms.canAddEdit)
  );

  // Check for tour state in URL parameters
  const tourParam = searchParams.get("tour");
  const stepParam = searchParams.get("step");
  const manualParam = searchParams.get("manual");

  // Parse current step from URL
  const currentStep = stepParam ? parseInt(stepParam, 10) : 0;

  // Memoize tour steps so they're only recreated when projectId or permissions change,
  // not on every searchParams update (which happens frequently on repository pages)
  const tourSteps = useMemo(
    () =>
      createTourSteps(t, projectId, {
        canSeeSharedSteps,
        canSeeReports,
        canSeeSettings,
      }),
    [t, projectId, canSeeSharedSteps, canSeeReports, canSeeSettings]
  );

  const handleTourComplete = useCallback(
    (tourName: string | null) => {
      (window as any).__activeTour = null;
      localStorage.setItem("hasSeenOnboardingTour", "true");

      // Clear active tour reference
      activeTourRef.current = null;

      // Update user preferences in the background (don't block navigation)
      if (session?.user?.id && userPreferences?.id) {
        updateUserPreferences({
          where: { id: userPreferences.id },
          data: { hasCompletedWelcomeTour: true },
        }).catch((error: unknown) => {
          console.error("Failed to update tour completion status:", error);
        });
      }

      // If the welcome tour just finished and a Demo Project exists,
      // automatically start the demo project tour
      if (tourName === "mainTour" && demoProject) {
        router.push(
          `/projects/overview/${demoProject.id}?tour=demoProjectTour&step=0`
        );
        return;
      }

      // Remove tour parameters from URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("tour");
      newSearchParams.delete("step");
      newSearchParams.delete("manual");
      router.replace(
        pathname +
          (newSearchParams.toString() ? `?${newSearchParams.toString()}` : "")
      );
    },
    [
      searchParams,
      pathname,
      router,
      session?.user?.id,
      userPreferences,
      updateUserPreferences,
      demoProject,
    ]
  );

  const handleTourSkip = useCallback(
    async (step: number, tourName: string | null) => {
      (window as any).__activeTour = null;
      localStorage.setItem("hasSeenOnboardingTour", "true");

      // Update user preferences if user is logged in and preferences exist
      if (session?.user?.id && userPreferences?.id) {
        try {
          await updateUserPreferences({
            where: { id: userPreferences.id },
            data: { hasCompletedWelcomeTour: true },
          });
        } catch (error) {
          console.error("Failed to update tour completion status:", error);
        }
      }

      // Clear active tour reference
      activeTourRef.current = null;

      // Remove tour parameters from URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("tour");
      newSearchParams.delete("step");
      newSearchParams.delete("manual");
      router.replace(
        pathname +
          (newSearchParams.toString() ? `?${newSearchParams.toString()}` : "")
      );
    },
    [
      searchParams,
      pathname,
      router,
      session?.user?.id,
      userPreferences,
      updateUserPreferences,
    ]
  );

  const handleStepChange = useCallback(
    (step: number, tourName: string | null) => {
      if (tourName === "demoProjectTour") {
        // Look up the current step's selector to decide auto-click actions
        const demoTour = tourSteps.find((t) => t.tour === "demoProjectTour");
        const selector = demoTour?.steps[step]?.selector;

        // Auto-click the first shared step group to show its steps
        if (selector === "[data-testid^='shared-step-group-']") {
          const firstGroup = document.querySelector(
            "[data-testid^='shared-step-group-']"
          ) as HTMLElement;
          if (firstGroup) {
            firstGroup.click();
          }
        }

        // Auto-click the first folder to populate the cases table
        if (selector === "[data-testid='repository-right-panel-header']") {
          const firstFolder = document.querySelector(
            "[data-testid^='folder-node-']"
          ) as HTMLElement;
          if (firstFolder) {
            firstFolder.click();
          }
        }
      }

      // Only update URL parameters for tours that need cross-page navigation
      // Main tour doesn't need URL tracking as it navigates within the same page
      if (tourName === "projectTour" || tourName === "demoProjectTour") {
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set("tour", tourName);
        newSearchParams.set("step", step.toString());
        // Remove manual flag after first step change
        newSearchParams.delete("manual");
        const newUrl = pathname + `?${newSearchParams.toString()}`;
        router.replace(newUrl);
      }
    },
    [searchParams, pathname, router, tourSteps]
  );

  // Store refs for the override to avoid stale closures
  const pathnameRef = useRef(pathname);
  const searchParamsRef = useRef(searchParams);
  const routerRef = useRef(router);
  pathnameRef.current = pathname;
  searchParamsRef.current = searchParams;
  routerRef.current = router;

  useEffect(() => {
    // Only set up override once — save the ORIGINAL Controller function
    // and never chain overrides on top of overrides
    if ((window as any).__tourOverrideInstalled) return;

    const originalStartTour = (window as any).startOnboardingTour;
    if (!originalStartTour) return;

    // Save the original Controller function permanently
    (window as any)._originalStartOnboardingTour = originalStartTour;
    (window as any).__tourOverrideInstalled = true;

    (window as any).startOnboardingTour = (tourName: string = "mainTour") => {
      // Set active tour reference + global flag
      activeTourRef.current = tourName;
      (window as any).__activeTour = tourName;

      // Call the original Controller function
      originalStartTour(tourName);

      // Only add URL parameters for tours that need cross-page navigation
      if (tourName === "projectTour" || tourName === "demoProjectTour") {
        setTimeout(() => {
          const currentPathname = pathnameRef.current;
          const newSearchParams = new URLSearchParams(searchParamsRef.current);
          newSearchParams.set("tour", tourName);
          newSearchParams.set("step", "0");
          newSearchParams.set("manual", "true");
          const newUrl = currentPathname + `?${newSearchParams.toString()}`;
          routerRef.current.replace(newUrl);
        }, 100);
      }
    };

    return () => {
      // Clean up on unmount
      delete (window as any).__tourOverrideInstalled;
    };
  }, []);

  useEffect(() => {
    // Check if user has seen the tour before
    const hasSeenTour = localStorage.getItem("hasSeenOnboardingTour");

    // Check for tour state in URL parameters (for page refresh restoration)
    // Only restore if the tour isn't already running — NextStep's MutationObserver
    // handles cross-page navigation natively during same-session navigation.
    // __activeTour persists during client-side navigation but clears on page refresh.
    if (
      (tourParam === "projectTour" || tourParam === "demoProjectTour") &&
      !manualParam &&
      !(window as any).__activeTour
    ) {
      // Set active tour reference for restoration
      activeTourRef.current = tourParam;
      (window as any).__activeTour = tourParam;

      // Small delay to ensure DOM is ready
      setTimeout(() => {
        // Access the original startOnboardingTour without URL parameter override
        const originalStartTour = (window as any)._originalStartOnboardingTour;
        if (originalStartTour) {
          const targetStep = parseInt(stepParam || "0", 10);

          // Hide the tour UI while we jump to the correct step to prevent
          // a flash of step 0 content before the target step renders
          if (targetStep > 0) {
            const style = document.createElement("style");
            style.id = "nextstep-restoration-hide";
            style.textContent =
              '[data-name="nextstep-overlay"], [data-name="nextstep-card"], [data-name="nextstep-overlay2"] { visibility: hidden !important; }';
            document.head.appendChild(style);
          }

          originalStartTour(tourParam);
          // Jump to the correct step immediately after starting
          if (targetStep > 0) {
            (window as any).__setTourStep?.(targetStep);
            // Remove the hiding style after the step is set (setCurrentStep uses setTimeout(0))
            setTimeout(() => {
              const hideStyle = document.getElementById(
                "nextstep-restoration-hide"
              );
              if (hideStyle) hideStyle.remove();
            }, 50);
          }
        }
      }, 1000);
      return;
    }

    // Check if user has completed the welcome tour
    const hasSeenTourInStorage = hasSeenTour;

    // Only proceed if we have user preferences loaded or user is not logged in
    // This prevents showing the tour while preferences are still loading
    const hasCompletedTourInPreferences =
      userPreferences?.hasCompletedWelcomeTour;

    // If user is logged in but preferences haven't loaded yet, don't show the tour
    if (session?.user?.id && userPreferences === undefined) {
      return; // Wait for preferences to load
    }

    // Show tour for new users (first visit to the app)
    // Check both localStorage (for backward compatibility) and user preferences
    // Only show if explicitly not completed (not undefined/null)
    if (
      !hasSeenTourInStorage &&
      hasCompletedTourInPreferences === false &&
      pathname.includes("/projects")
    ) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        if ((window as any).startOnboardingTour) {
          (window as any).startOnboardingTour("mainTour");
        }
      }, 1000);
    }
  }, [
    pathname,
    tourParam,
    manualParam,
    stepParam,
    userPreferences,
    session?.user?.id,
  ]);

  return (
    <NextStepProvider>
      <NextStep
        steps={tourSteps}
        onComplete={handleTourComplete}
        onSkip={handleTourSkip}
        onStepChange={handleStepChange}
        shadowRgb="0, 0, 0"
        shadowOpacity="0.3"
        displayArrow={true}
        scrollToTop={false}
        noInViewScroll={true}
        cardComponent={TourCard}
        navigationAdapter={useI18nNavigationAdapter}
      >
        <NextStepController />
        {children}
      </NextStep>
    </NextStepProvider>
  );
}

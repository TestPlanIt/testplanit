"use client";

import {
  NextStep,
  NextStepProvider,
  useNextStep,
  Tour,
  CardComponentProps,
  NavigationAdapter,
} from "nextstepjs";
import { useEffect, useCallback, useRef, useMemo } from "react";
import { usePathname, useRouter } from "~/lib/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  useFindFirstUserPreferences,
  useUpdateUserPreferences,
} from "~/lib/hooks";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

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
          selector: "#settings-link",
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
        "#settings-link": "settings",
      };
      for (let i = 0; i < steps.length - 1; i++) {
        const nextSelector = steps[i + 1].selector;
        const nextPage = nextSelector ? routeMap[nextSelector] : undefined;
        if (nextPage && projectId) {
          steps[i].nextRoute = `/projects/${nextPage}/${projectId}`;
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
    steps: [
      // Step 0: Project selector
      {
        icon: null,
        title: t("help.tour.demoProjectTour.projectSelector.title"),
        content: t("help.tour.demoProjectTour.projectSelector.content"),
        selector: "[data-testid='project-dropdown-trigger']",
        side: "bottom-left",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/overview/${projectId}?tour=demoProjectTour&step=1`
          : undefined,
      },
      // Step 1: Overview — project dashboard
      {
        icon: null,
        title: t("help.tour.demoProjectTour.overview.title"),
        content: t("help.tour.demoProjectTour.overview.content"),
        selector: "#overview-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/documentation/${projectId}?tour=demoProjectTour&step=2`
          : undefined,
      },
      // Step 2: Documentation sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.documentation.title"),
        content: t("help.tour.demoProjectTour.documentation.content"),
        selector: "#documentation-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/overview/${projectId}?tour=demoProjectTour&step=1`
          : undefined,
      },
      // Step 3: Documentation content
      {
        icon: null,
        title: t("help.tour.demoProjectTour.documentationContent.title"),
        content: t("help.tour.demoProjectTour.documentationContent.content"),
        selector: "#documentation-content",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/milestones/${projectId}?tour=demoProjectTour&step=4`
          : undefined,
      },
      // Step 4: Milestones sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.milestones.title"),
        content: t("help.tour.demoProjectTour.milestones.content"),
        selector: "#milestones-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/documentation/${projectId}?tour=demoProjectTour&step=3`
          : undefined,
      },
      // Step 5: Milestones page content
      {
        icon: null,
        title: t("help.tour.demoProjectTour.milestonesPage.title"),
        content: t("help.tour.demoProjectTour.milestonesPage.content"),
        selector: "#milestones-page-header",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/repository/${projectId}?tour=demoProjectTour&step=6`
          : undefined,
      },
      // Step 6: Repository sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.repository.title"),
        content: t("help.tour.demoProjectTour.repository.content"),
        selector: "#test-cases-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/milestones/${projectId}?tour=demoProjectTour&step=5`
          : undefined,
      },
      // Step 7: Repository folder panel
      {
        icon: null,
        title: t("help.tour.demoProjectTour.repositoryPanels.title"),
        content: t("help.tour.demoProjectTour.repositoryPanels.content"),
        selector: "[data-testid='repository-left-panel-header']",
        side: "bottom-right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      // Step 8: Repository test cases table
      {
        icon: null,
        title: t("help.tour.demoProjectTour.repositoryCases.title"),
        content: t("help.tour.demoProjectTour.repositoryCases.content"),
        selector: "[data-testid='repository-right-panel-header']",
        side: "bottom-left",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/shared-steps/${projectId}?tour=demoProjectTour&step=9`
          : undefined,
      },
      // Step 9: Shared Steps sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.sharedSteps.title"),
        content: t("help.tour.demoProjectTour.sharedSteps.content"),
        selector: "#shared-steps-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/repository/${projectId}?tour=demoProjectTour&step=8`
          : undefined,
      },
      // Step 10: Shared Steps page content
      {
        icon: null,
        title: t("help.tour.demoProjectTour.sharedStepsPage.title"),
        content: t("help.tour.demoProjectTour.sharedStepsPage.content"),
        selector: "[data-testid^='shared-step-group-']",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/runs/${projectId}?tour=demoProjectTour&step=11`
          : undefined,
      },
      // Step 11: Test Runs sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.testRuns.title"),
        content: t("help.tour.demoProjectTour.testRuns.content"),
        selector: "#test-runs-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/shared-steps/${projectId}?tour=demoProjectTour&step=10`
          : undefined,
      },
      // Step 12: Test Runs page content
      {
        icon: null,
        title: t("help.tour.demoProjectTour.testRunsPage.title"),
        content: t("help.tour.demoProjectTour.testRunsPage.content"),
        selector: "#test-runs-page-header",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/sessions/${projectId}?tour=demoProjectTour&step=13`
          : undefined,
      },
      // Step 13: Sessions sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.sessions.title"),
        content: t("help.tour.demoProjectTour.sessions.content"),
        selector: "#exploratory-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/runs/${projectId}?tour=demoProjectTour&step=12`
          : undefined,
      },
      // Step 14: Sessions page content
      {
        icon: null,
        title: t("help.tour.demoProjectTour.sessionsPage.title"),
        content: t("help.tour.demoProjectTour.sessionsPage.content"),
        selector: "#sessions-page-header",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/tags/${projectId}?tour=demoProjectTour&step=15`
          : undefined,
      },
      // Step 15: Tags sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.tags.title"),
        content: t("help.tour.demoProjectTour.tags.content"),
        selector: "#project-tags-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/sessions/${projectId}?tour=demoProjectTour&step=14`
          : undefined,
      },
      // Step 16: Tags page content
      {
        icon: null,
        title: t("help.tour.demoProjectTour.tagsPage.title"),
        content: t("help.tour.demoProjectTour.tagsPage.content"),
        selector: "#tags-page-header",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/tags/${projectId}?tour=demoProjectTour&step=15`
          : undefined,
        nextRoute: projectId
          ? `/projects/issues/${projectId}?tour=demoProjectTour&step=17`
          : undefined,
      },
      // Step 17: Issues sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.issues.title"),
        content: t("help.tour.demoProjectTour.issues.content"),
        selector: "#project-issues-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/tags/${projectId}?tour=demoProjectTour&step=16`
          : undefined,
      },
      // Step 18: Issues page content
      {
        icon: null,
        title: t("help.tour.demoProjectTour.issuesPage.title"),
        content: t("help.tour.demoProjectTour.issuesPage.content"),
        selector: "#issues-page-header",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/reports/${projectId}?tour=demoProjectTour&step=19`
          : undefined,
      },
      // Step 19: Reports sidebar link
      {
        icon: null,
        title: t("help.tour.demoProjectTour.reports.title"),
        content: t("help.tour.demoProjectTour.reports.content"),
        selector: "#reports-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/issues/${projectId}?tour=demoProjectTour&step=18`
          : undefined,
        nextRoute: projectId
          ? `/projects/settings/${projectId}?tour=demoProjectTour&step=20`
          : undefined,
      },
      // Step 20: Settings sidebar link (final step)
      {
        icon: null,
        title: t("help.tour.demoProjectTour.settings.title"),
        content: t("help.tour.demoProjectTour.settings.content"),
        selector: "#settings-link",
        side: "right",
        showControls: true,
        showSkip: false,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/reports/${projectId}?tour=demoProjectTour&step=19`
          : undefined,
      },
    ],
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
      console.log("[Tour:NavAdapter] push called:", path, "from:", pathname);
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
      console.log("[Tour:Controller] startOnboardingTour called:", tourName);
      startNextStep(tourName);
    };

    // Also expose admin tour function for consistency
    (window as any).startAdminTour = (tourName: string = "adminTour") => {
      console.log("[Tour:Controller] startAdminTour called:", tourName);
      startNextStep(tourName);
    };

    // Expose setCurrentStep for cross-page tour restoration
    (window as any).__setTourStep = (step: number) => {
      console.log("[Tour:Controller] __setTourStep called:", step);
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

  // Debug: listen for popstate events (NextStep closes tour on popstate)
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      console.log(
        "[Tour:PopState] popstate event fired!",
        "state:",
        e.state,
        "location:",
        window.location.href,
        "activeTour:",
        activeTourRef.current
      );
      console.trace("[Tour:PopState] stack trace");
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Track pathname changes for debugging
  // Don't clear activeTourRef here — NextStep's MutationObserver handles
  // cross-page step transitions natively. Clearing would cause the restoration
  // effect to re-start the tour, causing a disappear/reappear flash.
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      console.log(
        "[Tour:Pathname] changed:",
        prevPathnameRef.current,
        "→",
        pathname,
        "| activeTour:",
        (window as any).__activeTour
      );
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
    async (tourName: string | null) => {
      console.log("[Tour:Complete] tourName:", tourName);
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

  const handleTourSkip = useCallback(
    async (step: number, tourName: string | null) => {
      console.log("[Tour:Skip] step:", step, "tourName:", tourName);
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
      console.log(
        "[Tour:StepChange] step:",
        step,
        "tour:",
        tourName,
        "pathname:",
        pathname
      );

      // Demo tour: click the first shared step group to show its steps
      if (tourName === "demoProjectTour" && step === 10) {
        const firstGroup = document.querySelector(
          "[data-testid^='shared-step-group-']"
        ) as HTMLElement;
        if (firstGroup) {
          console.log("[Tour:StepChange] clicking first shared step group");
          firstGroup.click();
        }
      }

      // Demo tour: click the first folder to populate the cases table
      if (tourName === "demoProjectTour" && step === 8) {
        const firstFolder = document.querySelector(
          "[data-testid^='folder-node-']"
        ) as HTMLElement;
        if (firstFolder) {
          console.log(
            "[Tour:StepChange] clicking first folder to populate cases table"
          );
          firstFolder.click();
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
        console.log("[Tour:StepChange] router.replace →", newUrl);
        router.replace(newUrl);
      }
    },
    [searchParams, pathname, router]
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
      console.log(
        "[Tour:StartOverride] called:",
        tourName,
        "pathname:",
        pathnameRef.current
      );

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
          console.log("[Tour:StartOverride] setting URL params →", newUrl);
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
    console.log(
      "[Tour:Effect] fired | pathname:",
      pathname,
      "| tourParam:",
      tourParam,
      "| stepParam:",
      stepParam,
      "| manualParam:",
      manualParam,
      "| activeTourRef:",
      activeTourRef.current
    );

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
      console.log(
        "[Tour:Restore] will restore tour:",
        tourParam,
        "step:",
        stepParam,
        "activeTourRef was:",
        activeTourRef.current
      );

      // Set active tour reference for restoration
      activeTourRef.current = tourParam;
      (window as any).__activeTour = tourParam;

      // Small delay to ensure DOM is ready
      setTimeout(() => {
        // Access the original startOnboardingTour without URL parameter override
        const originalStartTour = (window as any)._originalStartOnboardingTour;
        console.log(
          "[Tour:Restore] timeout fired, originalStartTour exists:",
          !!originalStartTour
        );
        if (originalStartTour) {
          const targetStep = parseInt(stepParam || "0", 10);
          console.log(
            "[Tour:Restore] starting tour at targetStep:",
            targetStep
          );

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

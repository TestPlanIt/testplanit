"use client";

import {
  NextStep,
  NextStepProvider,
  useNextStep,
  Tour,
  CardComponentProps,
} from "nextstepjs";
import { useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter } from "~/lib/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  useFindFirstUserPreferences,
  useUpdateUserPreferences,
} from "~/lib/hooks";
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
      <Card className="w-80 shadow-lg border-border bg-card text-card-foreground">
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
  currentStep?: number
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
    steps: [
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
      {
        icon: null,
        title: t("help.tour.projectTour.projectSections.title"),
        content: t("help.tour.projectTour.projectSections.content"),
        selector: "#project-section",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/repository/${projectId}?tour=projectTour&step=2`
          : "/projects/repository?tour=projectTour&step=2",
      },
      {
        icon: null,
        title: t("repository.title"),
        content: t("help.tour.projectTour.repository.content"),
        selector: "#test-cases-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/repository/${projectId}?tour=projectTour&step=3`
          : "/projects/repository?tour=projectTour&step=3",
      },
      {
        icon: null,
        title: t("help.tour.projectTour.repositoryPanels.title"),
        content: t("help.tour.projectTour.repositoryPanels.content"),
        selector: "[data-testid='repository-left-panel-header']",
        side: "bottom-right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
      },
      {
        icon: null,
        title: t("help.tour.projectTour.repositoryRightPanel.title"),
        content: t("help.tour.projectTour.repositoryRightPanel.content"),
        selector: "[data-testid='repository-right-panel-header']",
        side: "bottom-left",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        nextRoute: projectId
          ? `/projects/runs/${projectId}?tour=projectTour&step=5`
          : "/projects/runs?tour=projectTour&step=5",
      },
      {
        icon: null,
        title: t("navigation.projects.menu.runs"),
        content: t("help.tour.projectTour.testRuns.content"),
        selector: "#test-runs-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/repository/${projectId}?tour=projectTour&step=4`
          : "/projects/repository?tour=projectTour&step=4",
        nextRoute: projectId
          ? `/projects/runs/${projectId}?tour=projectTour&step=6`
          : "/projects/runs?tour=projectTour&step=5",
      },
      {
        icon: null,
        title: t("help.tour.projectTour.testRunsPage.title"),
        content: t("help.tour.projectTour.testRunsPage.content"),
        selector: "#test-runs-page-header",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/runs/${projectId}?tour=projectTour&step=5`
          : "/projects/runs?tour=projectTour&step=5",
        nextRoute: projectId
          ? `/projects/sessions/${projectId}?tour=projectTour&step=7`
          : "/projects/sessions?tour=projectTour&step=7",
      },
      {
        icon: null,
        title: t("help.tour.projectTour.sessions.title"),
        content: t("help.tour.projectTour.sessions.content"),
        selector: "#exploratory-link",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/runs/${projectId}?tour=projectTour&step=6`
          : "/projects/runs?tour=projectTour&step=6",
        nextRoute: projectId
          ? `/projects/sessions/${projectId}?tour=projectTour&step=8`
          : "/projects/sessions?tour=projectTour&step=8",
      },
      {
        icon: null,
        title: t("help.tour.projectTour.sessionsPage.title"),
        content: t("help.tour.projectTour.sessionsPage.content"),
        selector: "#sessions-page-header",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/sessions/${projectId}?tour=projectTour&step=7`
          : "/projects/sessions?tour=projectTour&step=7",
        nextRoute: projectId
          ? `/projects/tags/${projectId}?tour=projectTour&step=9`
          : "/projects/tags?tour=projectTour&step=9",
      },
      {
        icon: null,
        title: t("help.tour.projectTour.tags.title"),
        content: t("help.tour.projectTour.tags.content"),
        selector: "#management-section a[href*='/tags']",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/sessions/${projectId}?tour=projectTour&step=7`
          : "/projects/sessions?tour=projectTour&step=7",
        nextRoute: projectId
          ? `/projects/issues/${projectId}?tour=projectTour&step=11`
          : "/projects/issues?tour=projectTour&step=11",
      },
      {
        icon: null,
        title: t("help.tour.projectTour.issues.title"),
        content: t("help.tour.projectTour.issues.content"),
        selector: "#management-section a[href*='/issues']",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/tags/${projectId}?tour=projectTour&step=10`
          : "/projects/tags?tour=projectTour&step=10",
        nextRoute: projectId
          ? `/projects/reports/${projectId}?tour=projectTour&step=12`
          : "/projects/reports?tour=projectTour&step=12",
      },
      {
        icon: null,
        title: t("help.tour.projectTour.reports.title"),
        content: t("help.tour.projectTour.reports.content"),
        selector: "#management-section a[href*='/reports']",
        side: "right",
        showControls: true,
        showSkip: false,
        pointerPadding: 10,
        prevRoute: projectId
          ? `/projects/issues/${projectId}?tour=projectTour&step=11`
          : "/projects/issues?tour=projectTour&step=11",
      },
    ],
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
];

interface NextStepOnboardingProps {
  children: React.ReactNode;
}

// Inner component that has access to NextStep context
function NextStepController() {
  const nextStepContext = useNextStep();
  const { startNextStep } = nextStepContext;

  useEffect(() => {
    // Expose the context functions globally
    (window as any).startOnboardingTour = (tourName: string = "mainTour") => {
      // console.log("Starting tour via context:", tourName);
      startNextStep(tourName);
    };

    // Also expose admin tour function for consistency
    (window as any).startAdminTour = (tourName: string = "adminTour") => {
      // console.log("Starting admin tour via context:", tourName);
      startNextStep(tourName);
    };

    return () => {
      delete (window as any).startOnboardingTour;
      delete (window as any).startAdminTour;
    };
  }, [startNextStep]);

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

  // Check for tour state in URL parameters
  const tourParam = searchParams.get("tour");
  const stepParam = searchParams.get("step");
  const manualParam = searchParams.get("manual");

  // Parse current step from URL
  const currentStep = stepParam ? parseInt(stepParam, 10) : 0;

  // Create tour steps with current translations and projectId
  const tourSteps = createTourSteps(t, projectId, currentStep);

  const handleTourComplete = useCallback(
    async (tourName: string | null) => {
      // console.log("Tour completed:", tourName);
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
      // console.log("Tour skipped at step:", step, "tour:", tourName);
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
      // console.log(
      //   "Step changed:",
      //   step,
      //   "tour:",
      //   tourName,
      //   "URL will show step:",
      //   step
      // );

      // Only update URL parameters for project tour (which needs cross-page navigation)
      // Main tour doesn't need URL tracking as it navigates within the same page
      if (tourName === "projectTour") {
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set("tour", tourName);
        newSearchParams.set("step", step.toString());
        // Remove manual flag after first step change
        newSearchParams.delete("manual");
        router.replace(pathname + `?${newSearchParams.toString()}`);
      }
    },
    [searchParams, pathname, router]
  );

  useEffect(() => {
    // Override the global function to add URL parameter handling
    const originalStartTour = (window as any).startOnboardingTour;
    if (originalStartTour) {
      // Store reference to original function
      (window as any)._originalStartOnboardingTour = originalStartTour;

      (window as any).startOnboardingTour = (tourName: string = "mainTour") => {
        // console.log("Starting tour with URL params:", tourName);

        // Set active tour reference
        activeTourRef.current = tourName;

        // Call the original function first to start the tour
        originalStartTour(tourName);

        // Only add URL parameters for project tour (which needs cross-page navigation)
        // Main tour doesn't need URL tracking as it doesn't navigate between pages
        if (tourName === "projectTour") {
          setTimeout(() => {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.set("tour", tourName);
            newSearchParams.set("step", "0");
            newSearchParams.set("manual", "true"); // Flag to distinguish manual start from restoration
            router.replace(pathname + `?${newSearchParams.toString()}`);
          }, 100);
        }
      };
    }
  }, [searchParams, pathname, router]);

  useEffect(() => {
    // Check if user has seen the tour before
    const hasSeenTour = localStorage.getItem("hasSeenOnboardingTour");

    // Check for tour state in URL parameters (for cross-page navigation)
    // Only restore project tour from URL (main tour doesn't use URL navigation)
    if (
      tourParam === "projectTour" &&
      !manualParam &&
      activeTourRef.current !== tourParam
    ) {
      // console.log(
      //   "Restoring tour from URL navigation:",
      //   tourParam,
      //   "step:",
      //   stepParam,
      //   "activeTour:",
      //   activeTourRef.current
      // );

      // Set active tour reference for restoration
      activeTourRef.current = tourParam;

      // Small delay to ensure DOM is ready
      setTimeout(() => {
        // Access the original startOnboardingTour without URL parameter override
        const originalStartTour = (window as any)._originalStartOnboardingTour;
        if (originalStartTour) {
          originalStartTour(tourParam);
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
      >
        <NextStepController />
        {children}
      </NextStep>
    </NextStepProvider>
  );
}

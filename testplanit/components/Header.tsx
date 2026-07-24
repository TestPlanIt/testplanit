"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  BookOpen,
  Clock,
  HelpCircle,
  LucideWaypoints,
  MessageSquareHeart,
  MoreVertical,
  Navigation,
  Search,
  Waypoints,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Link, usePathname, useRouter } from "~/lib/navigation";
import svgIcon from "~/public/tpi_logo.svg";

import {
  FeedbackBanner,
  FeedbackSurveySheet,
} from "@/components/FeedbackSurveySheet";
import { GlobalSearchSheet } from "@/components/GlobalSearchSheet";
import { NotificationBell } from "@/components/NotificationBell";
import { ProjectQuickSelector } from "@/components/ProjectQuickSelector";
import { ReviewInboxButton } from "@/components/reviews/ReviewInboxButton";
import { useContainerCompact } from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { UserDropdownMenu } from "@/components/UserDropdownMenu";
import { useHeaderAlertCounts } from "~/hooks/useHeaderAlertCounts";
import { getVersionString } from "~/lib/version";
import { cn } from "~/utils";

export const Header = () => {
  const router = useRouter();
  const path = usePathname();
  const { data: session, status } = useSession();
  const { setTheme } = useTheme();
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(
    null
  );
  const [trialContactEmail, setTrialContactEmail] = useState<string>(
    "sales@testplanit.com"
  );
  const [feedbackSurveyUrl, setFeedbackSurveyUrl] = useState<string | null>(
    null
  );
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [trialTotalDays, setTrialTotalDays] = useState<number>(0);
  const versionString = getVersionString();
  // Collapse the header action icons (search, help, notifications, review inbox)
  // into a single kebab menu once the header row gets too narrow to show them.
  const { ref: headerRef, compact: isHeaderCompact } =
    useContainerCompact(1024);
  // When collapsed, the notification + review-inbox icons hide inside the
  // kebab; surface their combined unread total on the kebab so it isn't missed.
  // Gated on `isHeaderCompact` so it only fetches while those icons are hidden.
  const { total: alertCount } = useHeaderAlertCounts(isHeaderCompact);
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const isOnProjectPage = path.includes("/projects/") && !!projectId;

  // Primary top-bar sections read as quiet tabs: muted by default, brightening
  // on hover, with a --primary underline marking the active section.
  const isNavActive = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`);
  const navLinkClass = (active: boolean) =>
    cn(
      "relative inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium no-underline transition-colors",
      "after:pointer-events-none after:absolute after:inset-x-2 after:bottom-1 after:h-[3px] after:rounded-full after:transition-colors",
      active
        ? "text-foreground font-semibold after:bg-primary"
        : "text-muted-foreground hover:text-foreground after:bg-transparent hover:after:bg-primary/40"
    );

  // Minimal query to check if current project is the Demo Project
  const { data: currentProject } = useClientQueries(
    schema
  ).projects.useFindUnique(
    {
      where: { id: Number(projectId) },
      select: { name: true },
    },
    { enabled: isOnProjectPage && !!projectId }
  );
  const isDemoProject = currentProject?.name === "Demo Project";

  // Reuse the same query as ProjectQuickSelector — React Query deduplicates it
  const { data: allProjects = [] } = useClientQueries(
    schema
  ).projects.useFindMany({
    where: { isDeleted: false },
    orderBy: [{ isCompleted: "asc" as const }, { name: "asc" as const }],
    select: {
      id: true,
      name: true,
      iconUrl: true,
      isCompleted: true,
      isDeleted: true,
    },
  });
  const demoProject = allProjects.find((p) => p.name === "Demo Project");

  // Fetch trial configuration from API (env vars are baked in at build time, so we need runtime fetch)
  useEffect(() => {
    const fetchTrialConfig = async () => {
      try {
        const response = await fetch("/api/config/trial");
        if (response.ok) {
          const data = await response.json();
          if (data.feedbackSurveyUrl) {
            setFeedbackSurveyUrl(data.feedbackSurveyUrl);
          }
          if (data.isTrialInstance && data.trialEndDate) {
            const end = new Date(data.trialEndDate);
            const now = new Date();
            const diff = Math.ceil(
              (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );
            setTrialDaysRemaining(diff);
            if (data.contactEmail) {
              setTrialContactEmail(data.contactEmail);
            }
            // Estimate days into trial (assume 30-day trial if we can't calculate)
            const totalDays = 30;
            setTrialTotalDays(totalDays - diff);
          }
        }
      } catch {
        // Silently fail - trial indicator is not critical
      }
    };
    void fetchTrialConfig();
  }, []);

  useEffect(() => {
    if (session?.user.preferences?.theme) {
      setTheme(session.user.preferences.theme.toLowerCase());
    }
  }, [session, setTheme]);

  useEffect(() => {
    // Only check email verification if the session is authenticated
    // If session is unauthenticated (expired), let the auth flow handle the redirect to sign-in
    // Skip email verification for SSO users (authMethod is SSO or BOTH)
    if (status === "authenticated" && session?.user) {
      const isSSO =
        session.user.authMethod === "SSO" || session.user.authMethod === "BOTH";
      if (!session.user.emailVerified && session.user.email && !isSSO) {
        router.push(
          "/verify-email?email=" + encodeURIComponent(session.user.email)
        );
      }
    }
  }, [session, status, router]);

  // Detect platform for keyboard shortcut display
  useEffect(() => {
    // Use userAgent as navigator.platform is deprecated
    const isMacOS = /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
    setIsMac(isMacOS);
  }, []);

  // Add keyboard shortcut for search (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if Cmd+K (Mac) or Ctrl+K (Windows/Linux) is pressed
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault(); // Prevent default browser behavior
        setIsSearchOpen(true);
      }
    };

    // Add event listener
    window.addEventListener("keydown", handleKeyDown);

    // Cleanup function to remove event listener
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Hide header on auth-related pages and when no session
  if (
    !session ||
    path.startsWith("/verify-email") ||
    path.startsWith("/auth/two-factor-setup") ||
    path.startsWith("/auth/two-factor-verify")
  ) {
    return null;
  }

  // Help menu items — shared by the standalone help dropdown and, when the
  // header collapses, the help submenu inside the kebab.
  const helpMenuItems = (
    <>
      <DropdownMenuItem
        onClick={() => (window as any).startOnboardingTour?.("mainTour")}
        className="cursor-pointer"
      >
        <Navigation className="me-2 h-4 w-4" />
        {t("help.menu.startTour")}
      </DropdownMenuItem>
      {isOnProjectPage &&
        (isDemoProject ? (
          <DropdownMenuItem
            onClick={() =>
              (window as any).startOnboardingTour?.("demoProjectTour")
            }
            className="cursor-pointer"
          >
            <Waypoints className="me-2 h-4 w-4" />
            {t("help.menu.startDemoProjectTour")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => (window as any).startOnboardingTour?.("projectTour")}
            className="cursor-pointer"
          >
            <Waypoints className="me-2 h-4 w-4" />
            {t("help.menu.startProjectTour")}
          </DropdownMenuItem>
        ))}
      {!isOnProjectPage && demoProject && (
        <DropdownMenuItem
          onClick={() =>
            router.push(
              `/projects/overview/${demoProject.id}?tour=demoProjectTour&step=0`
            )
          }
          className="cursor-pointer"
        >
          <Waypoints className="me-2 h-4 w-4" />
          {t("help.menu.startDemoProjectTour")}
        </DropdownMenuItem>
      )}
      {path.includes("/admin/") && (
        <DropdownMenuItem
          onClick={() => (window as any).startAdminTour?.("adminTour")}
          className="cursor-pointer"
        >
          <LucideWaypoints className="me-2 h-4 w-4" />
          {t("help.menu.startAdminTour")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onClick={() => window.open("https://docs.testplanit.com", "_blank")}
        className="cursor-pointer"
      >
        <BookOpen className="me-2 h-4 w-4" />
        {t("common.fields.documentation")}
      </DropdownMenuItem>
      {feedbackSurveyUrl && (
        <DropdownMenuItem
          onClick={() => setIsFeedbackOpen(true)}
          className="cursor-pointer"
        >
          <MessageSquareHeart className="me-2 h-4 w-4" />
          {t("feedback.menuItem")}
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <div className="flex flex-col">
      <div className="shadow-md top-0 z-50">
        <div
          ref={headerRef}
          id="header-container"
          data-testid="header-container"
          className={`items-center p-2 rounded-sm ${path.includes("admin") ? "bg-linear-to-b from-transparent from-60% to-red-500" : ""}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span id="header-logo" className="px-1 inline-block">
                <Link
                  href="/"
                  className="flex font-semibold tracking-tight text-2xl cursor-pointer text-[rgb(133,89,233)] no-underline"
                >
                  <Image
                    className="mx-2"
                    alt={t("common.branding.logoAlt")}
                    src={svgIcon}
                    style={{
                      width: "40px",
                      height: "auto",
                    }}
                    priority={true}
                  />
                  <div className="flex flex-col">
                    <span className="">{t("common.branding.name")}</span>
                    <div className="-mt-1 text-xs text-muted-foreground/60">
                      {versionString}
                    </div>
                  </div>
                </Link>
              </span>
              <Separator orientation="vertical" className="mx-4 h-8" />

              {session?.user?.access !== "NONE" && (
                <div className="whitespace-nowrap">
                  <span id="projects-link" className="py-2 px-1 inline-block">
                    <ProjectQuickSelector />
                  </span>
                  <span
                    id="global-features"
                    className="py-2 px-1 inline-flex items-center gap-1"
                  >
                    <Link
                      id="tags-link"
                      className={navLinkClass(isNavActive("/tags"))}
                      href="/tags"
                    >
                      {tCommon("fields.tags")}
                    </Link>
                    <Link
                      id="issues-link"
                      className={navLinkClass(isNavActive("/issues"))}
                      href="/issues"
                    >
                      {t("common.fields.issues")}
                    </Link>
                    <Link
                      id="users-link"
                      className={navLinkClass(isNavActive("/users"))}
                      href="/users"
                    >
                      {tCommon("fields.users")}
                    </Link>
                  </span>
                </div>
              )}

              {session?.user?.access === "ADMIN" && (
                <span className="py-2 px-1 inline-flex items-center">
                  <Link
                    className={navLinkClass(isNavActive("/admin"))}
                    href="/admin"
                  >
                    {t("common.access.admin")}
                  </Link>
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 shrink-0">
              {path.includes("admin") && (
                <Badge
                  variant="destructive"
                  className="gap-1 px-3 py-1.5 text-center"
                >
                  {t("common.access.admin")} {t("common.fields.tools")}
                </Badge>
              )}
              {trialDaysRemaining !== null && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      trialDaysRemaining < 0
                        ? "destructive"
                        : trialDaysRemaining < 7
                          ? "default"
                          : "secondary"
                    }
                    className="gap-2 px-3 py-1.5 text-sm font-medium"
                  >
                    <Clock className="h-4 w-4" />
                    <span>
                      {trialDaysRemaining < 0
                        ? t("Trial.expired", {
                            count: Math.abs(trialDaysRemaining),
                          })
                        : trialDaysRemaining === 0
                          ? t("Trial.expiresT oday")
                          : t("Trial.daysRemaining", {
                              count: trialDaysRemaining,
                            })}
                    </span>
                  </Badge>
                  <Link
                    href={`mailto:${trialContactEmail}?subject=TestPlanIt Trial - ${trialDaysRemaining < 0 ? "Expired" : "Upgrade Inquiry"}`}
                  >
                    {t("Trial.contactSales")}
                  </Link>
                </div>
              )}
              {!isHeaderCompact ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsSearchOpen(true)}
                    className="relative group"
                    aria-label={tCommon("aria.search")}
                    title={`Search (${isMac ? "⌘" : "Ctrl"}+K)`}
                    data-testid="global-search-trigger"
                  >
                    <Search className="h-5 w-5" />
                    <span className="absolute start-12 transform -translate-x-1/2 rtl:translate-x-1/2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      {isMac ? "⌘K" : "Ctrl+K"}
                    </span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative"
                        aria-label={tCommon("aria.helpMenu")}
                        title="Help & Support"
                        data-testid="help-menu-button"
                      >
                        <HelpCircle className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {helpMenuItems}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <NotificationBell />
                  <ReviewInboxButton />
                </>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative"
                      aria-label={
                        alertCount > 0
                          ? tCommon("actions.actionsWithAlerts", {
                              count: alertCount,
                            })
                          : tCommon("actions.actionsLabel")
                      }
                      data-testid="header-actions-menu"
                    >
                      <MoreVertical className="h-5 w-5" />
                      {alertCount > 0 && (
                        <Badge
                          variant="destructive"
                          className="absolute -top-1 -end-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                          data-testid="header-actions-count-badge"
                        >
                          {alertCount > 9 ? "9+" : alertCount}
                        </Badge>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {/* Reverse of the wide icon order: inbox, notifications,
                        help, search. */}
                    <ReviewInboxButton variant="menu" />
                    <NotificationBell variant="menu" />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger data-testid="help-menu-button">
                        <HelpCircle className="me-2 h-4 w-4" />
                        {tCommon("aria.help")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        {helpMenuItems}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                      onClick={() => setIsSearchOpen(true)}
                      className="cursor-pointer"
                      data-testid="global-search-trigger"
                    >
                      <Search className="me-2 h-4 w-4" />
                      {tCommon("aria.search")}
                      <DropdownMenuShortcut>
                        {isMac ? "⌘K" : "Ctrl+K"}
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <UserDropdownMenu />
            </div>
          </div>
        </div>
        <div className="mb-2" />
      </div>

      {feedbackSurveyUrl && (
        <FeedbackBanner
          trialStartDaysAgo={trialTotalDays}
          onOpenSurvey={() => setIsFeedbackOpen(true)}
        />
      )}

      <GlobalSearchSheet
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />

      {feedbackSurveyUrl && (
        <FeedbackSurveySheet
          isOpen={isFeedbackOpen}
          onClose={() => setIsFeedbackOpen(false)}
          surveyUrl={feedbackSurveyUrl}
          user={session?.user}
        />
      )}
    </div>
  );
};

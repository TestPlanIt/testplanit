"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, Link } from "~/lib/navigation";
import { usePathname } from "~/lib/navigation";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import Image from "next/image";
import svgIcon from "~/public/tpi_logo.svg";
import {
  Search,
  HelpCircle,
  BookOpen,
  Navigation,
  Waypoints,
  LucideWaypoints,
  Clock,
} from "lucide-react";

import { UserDropdownMenu } from "@/components/UserDropdownMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { Separator } from "@/components/ui/separator";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlobalSearchSheet } from "@/components/GlobalSearchSheet";
import { ProjectQuickSelector } from "@/components/ProjectQuickSelector";
import { getVersionString } from "~/lib/version";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Header = () => {
  const router = useRouter();
  const path = usePathname();
  const { data: session, status } = useSession();
  const { setTheme } = useTheme();
  const t = useTranslations();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(
    null
  );
  const versionString = getVersionString();

  // Calculate trial days remaining
  useEffect(() => {
    const isTrialInstance =
      process.env.NEXT_PUBLIC_IS_TRIAL_INSTANCE === "true";
    const trialEndDate = process.env.NEXT_PUBLIC_TRIAL_END_DATE;

    if (isTrialInstance && trialEndDate) {
      const end = new Date(trialEndDate);
      const now = new Date();
      const diff = Math.ceil(
        (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      setTrialDaysRemaining(diff);
    }
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

  if (!session || path.startsWith("/verify-email")) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <div className="shadow-md top-0 z-50">
        <div
          id="header-container"
          data-testid="header-container"
          className={`items-center p-2 rounded-sm ${path.includes("admin") ? "bg-linear-to-b from-transparent from-70% to-red-500 inset-ring-2 inset-ring-red-500" : ""}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex">
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
              <Separator orientation="vertical" className="px-4" />

              {session?.user?.access !== "NONE" && (
                <div className="whitespace-nowrap">
                  <span id="projects-link" className="py-2 px-1 inline-block">
                    <ProjectQuickSelector />
                  </span>
                  <span
                    id="global-features"
                    className="py-2 px-1 inline-flex gap-1"
                  >
                    <Link
                      id="tags-link"
                      className={`${buttonVariants({ variant: "link" })}`}
                      href="/tags"
                    >
                      {t("common.labels.tags")}
                    </Link>
                    <Link
                      id="issues-link"
                      className={`${buttonVariants({ variant: "link" })}`}
                      href="/issues"
                    >
                      {t("common.labels.issues")}
                    </Link>
                    <Link
                      id="users-link"
                      className={`${buttonVariants({ variant: "link" })}`}
                      href="/users"
                    >
                      {t("common.labels.users")}
                    </Link>
                  </span>
                </div>
              )}

              {session?.user?.access === "ADMIN" && (
                <span className="py-2 px-1 inline-block">
                  <Link
                    className={`${buttonVariants({ variant: "link" })}`}
                    href="/admin"
                  >
                    {t("common.labels.admin")}
                  </Link>
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 shrink-0">
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
                    href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL || "sales@testplanit.com"}?subject=TestPlanIt Trial - ${trialDaysRemaining < 0 ? "Expired" : "Upgrade Inquiry"}`}
                  >
                    {t("Trial.contactSales")}
                  </Link>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSearchOpen(true)}
                className="relative group"
                aria-label="Search"
                title={`Search (${isMac ? "⌘" : "Ctrl"}+K)`}
                data-testid="global-search-trigger"
              >
                <Search className="h-5 w-5" />
                <span className="absolute left-12 transform -translate-x-1/2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  {isMac ? "⌘K" : "Ctrl+K"}
                </span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label="Help menu"
                    title="Help & Support"
                    data-testid="help-menu-button"
                  >
                    <HelpCircle className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() =>
                      (window as any).startOnboardingTour?.("mainTour")
                    }
                    className="cursor-pointer"
                  >
                    <Navigation className="mr-2 h-4 w-4" />
                    {t("help.menu.startTour") || "Start Guided Tour"}
                  </DropdownMenuItem>
                  {path.includes("/projects/") && (
                    <DropdownMenuItem
                      onClick={() =>
                        (window as any).startOnboardingTour?.("projectTour")
                      }
                      className="cursor-pointer"
                    >
                      <Waypoints className="mr-2 h-4 w-4" />
                      {t("help.menu.startProjectTour") || "Project Tour"}
                    </DropdownMenuItem>
                  )}
                  {path.includes("/admin/") && (
                    <DropdownMenuItem
                      onClick={() =>
                        (window as any).startAdminTour?.("adminTour")
                      }
                      className="cursor-pointer"
                    >
                      <LucideWaypoints className="mr-2 h-4 w-4" />
                      {t("help.menu.startAdminTour") || "Admin Tour"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() =>
                      window.open("https://docs.testplanit.com", "_blank")
                    }
                    className="cursor-pointer"
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    {t("help.menu.documentation") || "Documentation"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <NotificationBell />
              <UserDropdownMenu />
            </div>
          </div>
        </div>
        <div className="mb-2" />
      </div>

      <GlobalSearchSheet
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </div>
  );
};

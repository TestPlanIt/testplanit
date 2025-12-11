"use client";

import { useEffect } from "react";
import { usePathname, Link, useRouter } from "~/lib/navigation";
import {
  CircleCheckBig,
  Combine,
  Boxes,
  Users,
  User,
  Drama,
  Milestone,
  LayoutList,
  Workflow,
  Tags,
  Settings,
  Trash2,
  ChartNoAxesCombined,
  Bell,
  Plug,
  ShieldUser,
  ShieldCheck,
  Sparkles,
  Search,
  ImportIcon,
  Bug,
  Activity,
  KeyRound,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";

type MenuOption = {
  icon?: React.ElementType;
  translationKey: string;
  path?: string;
  section?: string;
};

const menuOptions: MenuOption[] = [
  { translationKey: "header", section: "main" },
  {
    icon: Boxes,
    translationKey: "projects",
    path: "projects",
    section: "main",
  },
  {
    icon: LayoutList,
    translationKey: "templatesAndFields",
    path: "fields",
    section: "main",
  },
  {
    icon: Workflow,
    translationKey: "workflows",
    path: "workflows",
    section: "main",
  },
  {
    icon: CircleCheckBig,
    translationKey: "statuses",
    path: "statuses",
    section: "main",
  },
  {
    icon: Milestone,
    translationKey: "milestoneTypes",
    path: "milestones",
    section: "main",
  },
  {
    icon: Combine,
    translationKey: "configurations",
    path: "configurations",
    section: "main",
  },
  { icon: User, translationKey: "users", path: "users", section: "main" },
  {
    icon: Users,
    translationKey: "groups",
    path: "groups",
    section: "main",
  },
  { icon: Drama, translationKey: "roles", path: "roles", section: "main" },
  { icon: Tags, translationKey: "tags", path: "tags", section: "main" },
  {
    icon: Bug,
    translationKey: "issueTracker",
    path: "issues",
    section: "main",
  },
  {
    icon: ChartNoAxesCombined,
    translationKey: "reports",
    path: "reports",
    section: "main",
  },
  {
    icon: Bell,
    translationKey: "notifications",
    path: "notifications",
    section: "main",
  },
  {
    icon: Plug,
    translationKey: "integrations",
    path: "integrations",
    section: "main",
  },
  {
    icon: Sparkles,
    translationKey: "llm",
    path: "llm",
    section: "main",
  },
  {
    icon: ShieldUser,
    translationKey: "sso",
    path: "sso",
    section: "main",
  },
  {
    icon: KeyRound,
    translationKey: "apiTokens",
    path: "api-tokens",
    section: "main",
  },
  { translationKey: "systemHeader", section: "system" },
  {
    icon: Settings,
    translationKey: "appConfig",
    path: "app-config",
    section: "system",
  },
  {
    icon: ImportIcon,
    translationKey: "imports",
    path: "imports",
    section: "system",
  },
  {
    icon: Search,
    translationKey: "elasticsearch",
    path: "elasticsearch",
    section: "system",
  },
  {
    icon: Activity,
    translationKey: "queues",
    path: "queues",
    section: "system",
  },
  {
    icon: ShieldCheck,
    translationKey: "auditLogs",
    path: "audit-logs",
    section: "system",
  },
  {
    icon: Trash2,
    translationKey: "trash",
    path: "trash",
    section: "system",
  },
];

export default function AdminMenu() {
  const router = useRouter();
  const page = usePathname().split("/")[2];
  const menuButtonClass = "w-full rounded-none justify-start shadow-none";
  const t = useTranslations("admin.menu");

  useEffect(() => {
    if (page === undefined) {
      // Navigate to the first menu item's route
      const firstMenuItem = menuOptions.find((option) => option.path);
      if (firstMenuItem && firstMenuItem.path) {
        router.replace(`/admin/${firstMenuItem.path}`);
      }
    }
  }, [page, router]);

  const mainMenuItems = menuOptions.filter(
    (option) => option.section === "main"
  );
  const systemMenuItems = menuOptions.filter(
    (option) => option.section === "system"
  );

  return (
    <Card className="sticky top-0 z-10 rounded-none border-none h-full shadow-none">
      <CardContent className="bg-primary-foreground h-full p-0 flex flex-col">
        <CardHeader className="hidden md:inline">
          <CardTitle data-testid="admin-page-title">{t("header")}</CardTitle>
        </CardHeader>
        <div className="grow overflow-y-auto">
          {mainMenuItems.map((option: MenuOption, index: number) => {
            const isActive = page === `${option.path}`;
            const IconComponent = option.icon;

            if (!option.path) {
              // Render header
              return (
                <div
                  key={`header-${index}`}
                  className="ml-3 mb-2 mt-6 uppercase text-xs hidden md:inline"
                >
                  {t(option.translationKey as any)}
                </div>
              );
            }

            return (
              <Link
                key={option.path}
                id={`admin-menu-${option.path}`}
                href={`/admin/${option.path}`}
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  menuButtonClass,
                  "flex items-center py-2 md:py-0 no-underline",
                  isActive
                    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                    : "hover:bg-primary/10 hover:text-primary"
                )}
              >
                {IconComponent && <IconComponent className="min-w-6 min-h-6" />}
                <span
                  className={`hidden md:inline ${isActive ? "font-bold" : ""}`}
                >
                  {t(option.translationKey as any)}
                </span>
              </Link>
            );
          })}

          <div className="border-t border-border mt-6">
            {systemMenuItems.map((option: MenuOption, index: number) => {
              const isActive = page === `${option.path}`;
              const IconComponent = option.icon;

              if (!option.path) {
                // Render header
                return (
                  <div
                    key={`header-${index}`}
                    className="ml-3 mb-2 mt-4 uppercase text-xs hidden md:inline"
                  >
                    {t(option.translationKey as any)}
                  </div>
                );
              }

              return (
                <Link
                  key={option.path}
                  id={`admin-menu-${option.path}`}
                  href={`/admin/${option.path}`}
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
                    className={`hidden md:inline ${isActive ? "font-bold" : ""}`}
                  >
                    {t(option.translationKey as any)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
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
  ScrollText,
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
  Share2,
  MessageSquareCode,
  GitBranch,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";

type MenuSection =
  | "testManagement"
  | "peopleAndAccess"
  | "toolsAndIntegrations"
  | "system";

type MenuOption = {
  icon: React.ElementType;
  translationKey: string;
  path: string;
  section: MenuSection;
};

const sectionOrder: MenuSection[] = [
  "testManagement",
  "peopleAndAccess",
  "toolsAndIntegrations",
  "system",
];

const menuOptions: MenuOption[] = [
  // Test Management
  {
    icon: Boxes,
    translationKey: "projects",
    path: "projects",
    section: "testManagement",
  },
  {
    icon: LayoutList,
    translationKey: "templatesAndFields",
    path: "fields",
    section: "testManagement",
  },
  {
    icon: Workflow,
    translationKey: "workflows",
    path: "workflows",
    section: "testManagement",
  },
  {
    icon: CircleCheckBig,
    translationKey: "statuses",
    path: "statuses",
    section: "testManagement",
  },
  {
    icon: Milestone,
    translationKey: "milestoneTypes",
    path: "milestones",
    section: "testManagement",
  },
  {
    icon: Combine,
    translationKey: "configurations",
    path: "configurations",
    section: "testManagement",
  },
  {
    icon: Tags,
    translationKey: "tags",
    path: "tags",
    section: "testManagement",
  },
  {
    icon: Bug,
    translationKey: "issues",
    path: "issues",
    section: "testManagement",
  },
  {
    icon: ChartNoAxesCombined,
    translationKey: "reports",
    path: "reports",
    section: "testManagement",
  },

  // People & Access
  {
    icon: User,
    translationKey: "users",
    path: "users",
    section: "peopleAndAccess",
  },
  {
    icon: Users,
    translationKey: "groups",
    path: "groups",
    section: "peopleAndAccess",
  },
  {
    icon: Drama,
    translationKey: "roles",
    path: "roles",
    section: "peopleAndAccess",
  },
  {
    icon: ShieldUser,
    translationKey: "sso",
    path: "sso",
    section: "peopleAndAccess",
  },
  {
    icon: KeyRound,
    translationKey: "apiTokens",
    path: "api-tokens",
    section: "peopleAndAccess",
  },

  // Tools & Integrations
  {
    icon: Plug,
    translationKey: "integrations",
    path: "integrations",
    section: "toolsAndIntegrations",
  },
  {
    icon: Share2,
    translationKey: "shares",
    path: "shares",
    section: "toolsAndIntegrations",
  },
  {
    icon: Bell,
    translationKey: "notifications",
    path: "notifications",
    section: "toolsAndIntegrations",
  },
  {
    icon: Sparkles,
    translationKey: "llm",
    path: "llm",
    section: "toolsAndIntegrations",
  },
  {
    icon: MessageSquareCode,
    translationKey: "prompts",
    path: "prompts",
    section: "toolsAndIntegrations",
  },
  {
    icon: ScrollText,
    translationKey: "quickscriptTemplates",
    path: "quickscripts",
    section: "toolsAndIntegrations",
  },
  {
    icon: GitBranch,
    translationKey: "codeRepositories",
    path: "code-repositories",
    section: "toolsAndIntegrations",
  },

  // System
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

function getGroupedItems() {
  return sectionOrder.map((sectionKey) => ({
    key: sectionKey,
    items: menuOptions.filter((opt) => opt.section === sectionKey),
  }));
}

function MenuLink({
  option,
  isActive,
  menuButtonClass,
  t,
}: {
  option: MenuOption;
  isActive: boolean;
  menuButtonClass: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const IconComponent = option.icon;
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
      <IconComponent className="min-w-6 min-h-6" />
      <span className={`hidden md:inline ${isActive ? "font-bold" : ""}`}>
        {t(option.translationKey as any)}
      </span>
    </Link>
  );
}

export default function AdminMenu() {
  const router = useRouter();
  const page = usePathname().split("/")[2];
  const menuButtonClass = "w-full rounded-none justify-start shadow-none";
  const t = useTranslations("admin.menu");
  const tGlobal = useTranslations();

  const groups = getGroupedItems();

  const [openSections, setOpenSections] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("adminMenu:openSections");
        return stored ? (JSON.parse(stored) as string[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "adminMenu:openSections",
        JSON.stringify(openSections)
      );
    } catch {
      // ignore storage errors
    }
  }, [openSections]);

  useEffect(() => {
    if (page === undefined) {
      const firstMenuItem = menuOptions.find((option) => option.path);
      if (firstMenuItem) {
        router.replace(`/admin/${firstMenuItem.path}`);
      }
      return;
    }
    // Ensure the section containing the active page is open
    const activeSection = groups.find((group) =>
      group.items.some((item) => item.path === page)
    );
    if (activeSection && !openSections.includes(activeSection.key)) {
      setOpenSections((prev) => [...prev, activeSection.key]);
    }
  }, [page, router]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="sticky top-0 z-10 rounded-none border-none h-full shadow-none">
      <CardContent className="bg-primary-foreground h-full p-0 flex flex-col">
        <CardHeader className="hidden md:inline">
          <CardTitle data-testid="admin-page-title">
            {tGlobal("navigation.menu.admin")}
          </CardTitle>
        </CardHeader>
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
                className="border-b-0"
                data-testid={`admin-menu-section-${group.key}`}
              >
                <AccordionTrigger className="ml-3 py-2 mt-2 uppercase text-xs hover:no-underline hidden md:flex">
                  {t(group.key as any)}
                </AccordionTrigger>
                <AccordionContent className="pb-0 pt-0 max-md:block! max-md:h-auto! max-md:overflow-visible!">
                  {group.items.map((option) => (
                    <MenuLink
                      key={option.path}
                      option={option}
                      isActive={page === option.path}
                      menuButtonClass={menuButtonClass}
                      t={t}
                    />
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Activity, Inbox, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { usePathname, useRouter } from "~/lib/navigation";
import { ApplicationArea } from "~/zenstack/models";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { WebhookConfigForm } from "./webhook-config-form";
import { WebhookDeliveriesTab } from "./webhook-deliveries-tab";
import { WebhookOutboundForm } from "./webhook-outbound-form";

/**
 * Project-scoped webhooks admin page (sibling to /integrations).
 *
 * Webhooks are a transport-layer concern that crosses many features
 * (issue-tracker inbound sync, outbound event dispatch to Slack/etc).
 *
 * Access: same project-admin policy as the rest of project settings — the
 * page-level gate is the `isProjectAdmin` resolution, which mirrors the
 * WebhookConfig ZenStack policy + canManageWebhookConfig server-action
 * helper that provide the authoritative authorization.
 */
export default function ProjectWebhooksPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const t = useTranslations("projects.settings.webhooks");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabFromUrl = searchParams?.get("tab");
  const activeTab =
    tabFromUrl === "outbound"
      ? "outbound"
      : tabFromUrl === "deliveries"
        ? "deliveries"
        : "inbound";
  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Fetch project data (allow global admin access or project assignment).
  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        assignedUsers: {
          where: { user: { id: session?.user?.id || "" } },
          select: { user: { select: { access: true } } },
        },
      },
    },
    { enabled: isAuthenticated }
  );

  // Mirrors `canManageWebhookConfig` (lib/webhooks/auth.ts), the server-side
  // gate on every WebhookConfig write: system ADMIN, project creator,
  // per-project "Project Admin" role, or an assigned system PROJECTADMIN.
  // The old `session.user.access` check 404'd tiers 2 and 3.
  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;

    if (!project || !isProjectAdmin) notFound();
  }, [project, projectLoading, permissionsLoading, isProjectAdmin, session]);

  if (isAuthLoading) {
    return <Loading />;
  }
  if (projectLoading || permissionsLoading) {
    return <Loading />;
  }

  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <PageTitle className="mb-2">
            {tCommon("errors.projectNotFound")}
          </PageTitle>
          <p className="text-muted-foreground">
            {tCommon("errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{tGlobal("admin.menu.webhooks")}</CardTitle>
            <HelpPopover helpKey="projectWebhooks" />
          </SectionHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="w-full">
              <TabsTrigger
                value="inbound"
                data-testid="webhooks-tab-inbound"
                className="w-1/3 gap-2"
              >
                <Inbox className="h-4 w-4" />
                <span>{t("inboundTab")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="outbound"
                data-testid="webhooks-tab-outbound"
                className="w-1/3 gap-2"
              >
                <Send className="h-4 w-4" />
                <span>{t("outboundTab")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="deliveries"
                data-testid="webhooks-tab-deliveries"
                className="w-1/3 gap-2"
              >
                <Activity className="h-4 w-4" />
                <span>{t("deliveriesTab")}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inbound">
              <WebhookConfigForm projectId={projectId} />
            </TabsContent>
            <TabsContent value="outbound">
              <WebhookOutboundForm projectId={projectId} />
            </TabsContent>
            <TabsContent value="deliveries">
              <WebhookDeliveriesTab projectId={projectId} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}

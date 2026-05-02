"use client";

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
import { Activity, Inbox, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { usePathname, useRouter } from "~/lib/navigation";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useFindFirstProjects } from "~/lib/hooks";
import { WebhookConfigForm } from "./webhook-config-form";
import { WebhookDeliveriesTab } from "./webhook-deliveries-tab";
import { WebhookOutboundForm } from "./webhook-outbound-form";

/**
 * Project-scoped webhooks admin page (sibling to /integrations).
 *
 * Webhooks are a transport-layer concern that crosses many features
 * (issue-tracker inbound sync, outbound event dispatch to Slack/etc).
 * Phase 1 mistakenly nested the webhook config form under Issue
 * Integrations; this page corrects that placement before Phases 2-4
 * add outbound dispatch and additional inbound adapters that have
 * nothing to do with issue trackers.
 *
 * Phase 2 wraps the original Phase 1 form in a `<Tabs>` primitive (D-27)
 * with an "Outbound" sibling tab containing `WebhookOutboundForm`. Tab
 * state lives in the URL `?tab=` query param so reload + share preserve
 * the active tab.
 *
 * Access: same project-admin policy as the rest of project settings —
 * the page-level gate is `session.user.access ∈ {ADMIN, PROJECTADMIN}`,
 * and the WebhookConfig ZenStack policy + canManageWebhookConfig
 * server-action helper provide the authoritative authorization.
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

  // Tab state via URL query param so a reload (or shared link) preserves the
  // active tab. Default 'inbound' matches Phase 1 single-form behavior.
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
  const { data: project, isLoading: projectLoading } = useFindFirstProjects(
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

  useEffect(() => {
    if (!projectLoading && project && session?.user) {
      const hasAccess =
        session.user.access === "ADMIN" ||
        session.user.access === "PROJECTADMIN";
      if (!hasAccess) notFound();
    } else if (!projectLoading && !project && session?.user) {
      notFound();
    }
  }, [project, projectLoading, session]);

  if (isAuthLoading) {
    return <Loading />;
  }
  if (projectLoading) {
    return <Loading />;
  }

  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <h2 className="text-2xl font-semibold mb-2">
            {tCommon("errors.projectNotFound")}
          </h2>
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
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{tGlobal("admin.menu.webhooks")}</span>
            </CardTitle>
          </div>
          <CardDescription className="uppercase">
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

"use client";

import { Loading } from "@/components/Loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "~/lib/navigation";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { SYSTEM_PROJECT_ID } from "~/lib/scim/constants";
import { WebhookDeliveriesTab } from "~/app/[locale]/projects/settings/[projectId]/webhooks/webhook-deliveries-tab";
import { WebhookOutboundForm } from "~/app/[locale]/projects/settings/[projectId]/webhooks/webhook-outbound-form";

/**
 * System-level outbound webhooks admin page.
 *
 * The project-scoped webhook page at /projects/settings/{projectId}/webhooks
 * handles project events (test runs, sessions, issues, ...). This page
 * handles events the system emits with `projectId = SYSTEM_PROJECT_ID`
 * (-1) — currently the ten SCIM lifecycle events plus their two summary
 * coalescing types.
 *
 * Access: global ADMIN only. The `canManageWebhookConfig` server-side
 * helper short-circuits to `true` for `session.user.access === "ADMIN"`
 * regardless of `projectId`, so the existing webhook-config server actions
 * authorize this page's writes without modification.
 *
 * No inbound tab — there are no system-level inbound webhook adapters today
 * (inbound issue-tracker sync is per-project).
 */
export default function AdminWebhooksPage() {
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const t = useTranslations("admin.systemWebhooks");
  const tProjectWebhooks = useTranslations("projects.settings.webhooks");

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabFromUrl = searchParams?.get("tab");
  const activeTab = tabFromUrl === "deliveries" ? "deliveries" : "outbound";
  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`);
  };

  if (isAuthLoading) {
    return <Loading />;
  }
  if (!isAuthenticated) {
    return null;
  }
  if (session?.user?.access !== "ADMIN") {
    notFound();
  }

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2 pb-2 pt-1">
            <CardTitle>{t("title")}</CardTitle>
            <HelpPopover helpKey="systemWebhooks" />
          </SectionHeader>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="w-full">
              <TabsTrigger
                value="outbound"
                data-testid="system-webhooks-tab-outbound"
                className="w-1/2 gap-2"
              >
                <Send className="h-4 w-4" />
                <span>{tProjectWebhooks("outboundTab")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="deliveries"
                data-testid="system-webhooks-tab-deliveries"
                className="w-1/2 gap-2"
              >
                <Activity className="h-4 w-4" />
                <span>{tProjectWebhooks("deliveriesTab")}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="outbound">
              <WebhookOutboundForm
                projectId={SYSTEM_PROJECT_ID}
                scope="system"
              />
            </TabsContent>
            <TabsContent value="deliveries">
              <WebhookDeliveriesTab projectId={SYSTEM_PROJECT_ID} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}

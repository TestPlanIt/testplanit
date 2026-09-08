"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import LoadingSpinner from "~/components/LoadingSpinner";
import { ReportBuilder } from "~/components/reports/ReportBuilder";
import { useRouter } from "~/lib/navigation";

export default function AdminReportsPage() {
  const tGlobal = useTranslations();
  const { data: session, status } = useSession();
  const router = useRouter();

  // Check admin access
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user || session.user.access !== "ADMIN") {
      router.replace("/");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return <LoadingSpinner />;
  }

  if (!session?.user || session.user.access !== "ADMIN") {
    return null;
  }

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle
              data-testid="adminreports-page-title"
              className="items-center flex gap-1"
            >
              {tGlobal("navigation.admin.crossProjectReports")}
            </CardTitle>
            <HelpPopover helpKey="crossProjectReports" />
          </SectionHeader>
        </CardHeader>
        <CardContent className="p-0">
          <ReportBuilder mode="cross-project" />
        </CardContent>
      </Card>
    </main>
  );
}

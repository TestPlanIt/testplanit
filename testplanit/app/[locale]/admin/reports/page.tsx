"use client";
import React, { useEffect } from "react";
import { ReportBuilder } from "~/components/reports/ReportBuilder";
import { getCrossProjectReportTypes } from "~/lib/config/reportTypes";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { Globe } from "lucide-react";
import LoadingSpinner from "~/components/LoadingSpinner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";

export default function AdminReportsPage() {
  const tReports = useTranslations("reports.ui");
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

  const reportTypes = getCrossProjectReportTypes(tReports);

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle
                data-testid="adminreports-page-title"
                className="items-center flex gap-1"
              >
                <Globe className="h-8 w-8 shrink-0" />
                {tReports("crossProjectReports.title")}
              </CardTitle>
            </div>
            <CardDescription>
              {tReports("crossProjectReports.description")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ReportBuilder mode="cross-project" reportTypes={reportTypes} />
        </CardContent>
      </Card>
    </main>
  );
}

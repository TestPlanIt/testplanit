"use client";

import { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

interface AuthBypassPromptProps {
  userName: string;
  projectName: string;
  shareData: any;
}

export function AuthBypassPrompt({
  userName,
  projectName,
  shareData,
}: AuthBypassPromptProps) {
  const [isVisible, setIsVisible] = useState(true);
  const t = useTranslations("reports.authBypass");

  useEffect(() => {
    // Auto-dismiss after 5 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
      <Alert className="shadow-lg border-green-500/50 bg-background">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <AlertDescription className="space-y-2">
              <p className="font-medium">{t("title")}</p>
              <p className="text-sm text-muted-foreground">
                {t.rich("description", {
                  userName,
                  projectName,
                  strong: (chunks: React.ReactNode) => (
                    <strong>{chunks}</strong>
                  ),
                })}
              </p>
              {shareData.entityType === "REPORT" && shareData.projectId && (
                <Link href={`/en-US/projects/reports/${shareData.projectId}`}>
                  <Button variant="outline" size="sm" className="mt-2">
                    {t("viewInApp")}
                  </Button>
                </Link>
              )}
            </AlertDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => setIsVisible(false)}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t("dismiss")}</span>
          </Button>
        </div>
      </Alert>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { ShareDialog } from "./ShareDialog";
import { useTranslations } from "next-intl";

interface ShareButtonProps {
  projectId?: number; // Optional for cross-project reports
  reportConfig: any; // Report configuration (reportType, dimensions, metrics, etc.)
  reportTitle?: string;
  disabled?: boolean;
}

export function ShareButton({
  projectId,
  reportConfig,
  reportTitle,
  disabled = false,
}: ShareButtonProps) {
  const t = useTranslations("reports.shareDialog");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <Button
        data-testid="share-report-button"
        variant="ghost"
        size="sm"
        onClick={() => setIsDialogOpen(true)}
        disabled={disabled}
        className="gap-0 group overflow-hidden transition-all hover:gap-2"
      >
        <Share2 className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all group-hover:max-w-xs">
          {t("shareButton")}
        </span>
      </Button>

      <ShareDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        projectId={projectId}
        reportConfig={reportConfig}
        reportTitle={reportTitle}
      />
    </>
  );
}

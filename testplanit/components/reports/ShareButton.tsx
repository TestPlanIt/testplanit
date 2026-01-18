"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { ShareDialog } from "./ShareDialog";

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
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsDialogOpen(true)}
        disabled={disabled}
        className="gap-2"
      >
        <Share2 className="h-4 w-4" />
        Share
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

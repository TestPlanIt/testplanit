"use client";

import { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X } from "lucide-react";
import Link from "next/link";

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
              <p className="font-medium">You have access to this project</p>
              <p className="text-sm text-muted-foreground">
                Viewing as <strong>{userName}</strong> with access to{" "}
                <strong>{projectName}</strong>.
              </p>
              {shareData.entityType === "REPORT" && shareData.projectId && (
                <Link href={`/en-US/projects/reports/${shareData.projectId}`}>
                  <Button variant="outline" size="sm" className="mt-2">
                    View in full app
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
            <span className="sr-only">Dismiss</span>
          </Button>
        </div>
      </Alert>
    </div>
  );
}

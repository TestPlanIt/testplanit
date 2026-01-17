"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Copy, ExternalLink, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";

interface ShareLinkCreatedProps {
  shareData: any;
  onClose: () => void;
  onCreateAnother: () => void;
}

export function ShareLinkCreated({
  shareData,
  onClose,
  onCreateAnother,
}: ShareLinkCreatedProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareData.shareUrl);
      setCopied(true);
      toast({
        title: "Link copied!",
        description: "The share link has been copied to your clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please copy the link manually.",
        variant: "destructive",
      });
    }
  };

  const handleOpenLink = () => {
    window.open(shareData.shareUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      {/* Success header */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-1">Share Link Created!</h3>
          <p className="text-sm text-muted-foreground">
            Your share link is ready to use. Copy and share it with others.
          </p>
        </div>
      </div>

      {/* Share details */}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium mb-2 block">Share Link</label>
          <div className="flex gap-2">
            <Input
              value={shareData.shareUrl}
              readOnly
              className="font-mono text-sm"
              onClick={(e) => e.currentTarget.select()}
            />
            <Button
              onClick={handleCopy}
              variant="outline"
              className="shrink-0"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </>
              )}
            </Button>
            <Button
              onClick={handleOpenLink}
              variant="outline"
              className="shrink-0"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Share metadata */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Mode</p>
            <Badge variant="secondary">{shareData.mode.replace("_", " ")}</Badge>
          </div>
          {shareData.expiresAt && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Expires</p>
              <p className="text-sm font-medium">
                {format(new Date(shareData.expiresAt), "PPP")}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Notifications</p>
            <p className="text-sm font-medium">
              {shareData.notifyOnView ? "Enabled" : "Disabled"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Views</p>
            <p className="text-sm font-medium">{shareData.viewCount}</p>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {shareData.mode === "PUBLIC" && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Public link:</strong> Anyone with this link can access the report
            without authentication.
          </AlertDescription>
        </Alert>
      )}

      {shareData.expiresAt && (
        <Alert>
          <AlertDescription>
            This link will expire on{" "}
            <strong>{format(new Date(shareData.expiresAt), "PPP")}</strong> at midnight.
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button variant="outline" onClick={onCreateAnother}>
          Create Another
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

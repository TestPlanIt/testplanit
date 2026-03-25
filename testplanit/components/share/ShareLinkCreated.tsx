"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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

  const t = useTranslations("reports.shareDialog.created");
  const tCommon = useTranslations("common");
  const tToast = useTranslations("reports.shareDialog.shareList.toast");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareData.shareUrl);
      setCopied(true);
      toast.success(tToast("linkCopied"), {
        description: tToast("linkCopiedDescription"),
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tToast("copyFailed"), {
        description: tToast("copyFailedDescription"),
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
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-6 w-6 text-success" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-1">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </div>

      {/* Share details */}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium mb-2 block">{t("shareLink")}</label>
          <div className="flex gap-2">
            <Input
              data-testid="share-url-input"
              value={shareData.shareUrl}
              readOnly
              className="font-mono text-sm"
              onClick={(e) => e.currentTarget.select()}
            />
            <Button
              data-testid="share-copy-button"
              onClick={handleCopy}
              variant="outline"
              className="shrink-0"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  {tCommon("actions.copied")}
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  {t("copy")}
                </>
              )}
            </Button>
            <Button
              data-testid="share-open-button"
              onClick={handleOpenLink}
              variant="outline"
              className="shrink-0"
              aria-label={t("openInNewTab")}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Share metadata */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("metadata.mode")}</p>
            <Badge variant="secondary">{shareData.mode.replace("_", " ")}</Badge>
          </div>
          {shareData.expiresAt && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("metadata.expires")}</p>
              <p className="text-sm font-medium">
                {format(new Date(shareData.expiresAt), "PPP")}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-1">{tCommon("fields.notificationMode")}</p>
            <p className="text-sm font-medium">
              {shareData.notifyOnView ? tCommon("fields.enabled") : tCommon("status.disabled")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("metadata.views")}</p>
            <p className="text-sm font-medium">{shareData.viewCount}</p>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {shareData.mode === "PUBLIC" && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{t("warnings.publicLink")}</strong> {t("warnings.publicLinkDescription")}
          </AlertDescription>
        </Alert>
      )}

      {shareData.expiresAt && (
        <Alert>
          <AlertDescription>
            {t("warnings.expiresSoon")}{" "}
            <strong>{format(new Date(shareData.expiresAt), "PPP")}</strong>.
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button variant="outline" onClick={onCreateAnother}>
          {t("actions.createAnother")}
        </Button>
        <Button onClick={onClose}>{tCommon("actions.done")}</Button>
      </div>
    </div>
  );
}

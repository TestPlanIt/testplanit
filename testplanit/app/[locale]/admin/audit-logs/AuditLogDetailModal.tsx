"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTranslations } from "next-intl";
import { DateFormatter } from "@/components/DateFormatter";
import { useSession } from "next-auth/react";
import type { ExtendedAuditLog } from "./columns";

interface AuditLogDetailModalProps {
  log: ExtendedAuditLog | null;
  open: boolean;
  onClose: () => void;
}

export function AuditLogDetailModal({
  log,
  open,
  onClose,
}: AuditLogDetailModalProps) {
  const t = useTranslations("admin.auditLogs");
  const { data: session } = useSession();

  if (!log) return null;

  const changes = log.changes as Record<
    string,
    { old: unknown; new: unknown }
  > | null;
  const metadata = log.metadata as Record<string, unknown> | null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("detailTitle")}
            <Badge variant="outline">{log.action.replace(/_/g, " ")}</Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("columns.timestamp")}
                </label>
                <p className="text-sm">
                  <DateFormatter
                    date={log.timestamp}
                    formatString="MM-dd-yyyy HH:mm:ss"
                    timezone={session?.user?.preferences?.timezone || "Etc/UTC"}
                  />
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("columns.entityType")}
                </label>
                <p className="text-sm font-mono">{log.entityType}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("columns.entityId")}
                </label>
                <p className="text-sm font-mono break-all">{log.entityId}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("columns.entityName")}
                </label>
                <p className="text-sm">{log.entityName || "-"}</p>
              </div>
            </div>

            <Separator />

            {/* User Info */}
            <div>
              <h4 className="text-sm font-medium mb-2">{t("userInfo")}</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("columns.user")}
                  </label>
                  <p className="text-sm">{log.userName || "-"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Email
                  </label>
                  <p className="text-sm">{log.userEmail || "-"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    User ID
                  </label>
                  <p className="text-sm font-mono">{log.userId || "-"}</p>
                </div>
                {log.project && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("columns.project")}
                    </label>
                    <p className="text-sm">{log.project.name}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Changes */}
            {changes && Object.keys(changes).length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">{t("changes")}</h4>
                  <div className="space-y-2">
                    {Object.entries(changes).map(([field, change]) => (
                      <div
                        key={field}
                        className="bg-muted rounded-md p-3 text-sm"
                      >
                        <div className="font-medium mb-1">{field}</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-muted-foreground text-xs">
                              {t("oldValue")}:
                            </span>
                            <pre className="text-xs mt-1 bg-background p-2 rounded overflow-x-auto">
                              {formatValue(change.old)}
                            </pre>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs">
                              {t("newValue")}:
                            </span>
                            <pre className="text-xs mt-1 bg-background p-2 rounded overflow-x-auto">
                              {formatValue(change.new)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Metadata */}
            {metadata && Object.keys(metadata).length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">{t("metadata")}</h4>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                    {JSON.stringify(metadata, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

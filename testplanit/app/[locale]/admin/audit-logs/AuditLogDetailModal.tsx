"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

interface AuditLogDetailModalProps {
  logId: string | null;
  open: boolean;
  onClose: () => void;
}

export function AuditLogDetailModal({
  logId,
  open,
  onClose,
}: AuditLogDetailModalProps) {
  const t = useTranslations("admin.auditLogs");
  const tGlobal = useTranslations();
  const { data: session } = useSession();

  // Metadata can carry sensitive request details (IP address, user agent), so
  // the section is only surfaced to administrators. The case-scoped audit sheet
  // is shown to any viewer who can read the case, where this gate matters most.
  const canViewMetadata =
    session?.user?.access === "ADMIN" ||
    session?.user?.access === "PROJECTADMIN";

  // Fetch the full record (changes + metadata JSON) only when the modal opens.
  // The list query deliberately omits these columns to keep the page light at
  // scale — a single import can produce 100+ rows whose `changes` payload each
  // contains the full entity (kilobytes of Tiptap JSON for test cases).
  const { data: log, isLoading } = useClientQueries(
    schema
  ).auditLog.useFindUnique(
    {
      where: { id: logId ?? "" },
      include: { project: { select: { name: true } } },
    },
    { enabled: !!logId }
  );

  if (!logId) return null;

  const changes = (log?.changes ?? null) as Record<
    string,
    { old: unknown; new: unknown; oldName?: unknown; newName?: unknown }
  > | null;
  const metadata = (log?.metadata ?? null) as Record<string, unknown> | null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("detailTitle")}
            {log && (
              <Badge variant="outline">{log.action.replace(/_/g, " ")}</Badge>
            )}
            {metadata?.source === "scim" && (
              <Badge
                variant="outline"
                className="gap-1 font-mono"
                data-testid="audit-log-source-scim-badge"
              >
                <ShieldCheck className="size-3" aria-hidden="true" />
                {t("sourceScim")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !log ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {tGlobal("common.loading")}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-4">
            <div className="space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="overflow-hidden">
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("columns.timestamp")}
                  </label>
                  <p className="text-sm">
                    <DateFormatter
                      date={log.timestamp}
                      formatString="MM-dd-yyyy HH:mm:ss"
                      timezone={
                        session?.user?.preferences?.timezone || "Etc/UTC"
                      }
                    />
                  </p>
                </div>
                <div className="overflow-hidden">
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("filterEntityType")}
                  </label>
                  <p className="text-sm font-mono truncate">{log.entityType}</p>
                </div>
                <div className="overflow-hidden">
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("columns.entityId")}
                  </label>
                  <p className="text-sm font-mono break-all">{log.entityId}</p>
                </div>
                <div className="overflow-hidden">
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("columns.entityName")}
                  </label>
                  <p className="text-sm truncate">{log.entityName || "-"}</p>
                </div>
              </div>

              <Separator />

              {/* User Info */}
              <div>
                <h4 className="text-sm font-medium mb-2">{t("userInfo")}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {tGlobal("common.access.user")}
                    </label>
                    <p className="text-sm truncate">{log.userName || "-"}</p>
                  </div>
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {tGlobal("common.fields.email")}
                    </label>
                    <p className="text-sm truncate">{log.userEmail || "-"}</p>
                  </div>
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("columns.userId")}
                    </label>
                    <p className="text-sm font-mono break-all">
                      {log.userId || "-"}
                    </p>
                  </div>
                  {log.project && (
                    <div className="overflow-hidden">
                      <label className="text-sm font-medium text-muted-foreground">
                        {tGlobal("common.fields.project")}
                      </label>
                      <p className="text-sm truncate">{log.project.name}</p>
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
                          <div className="mb-2">
                            <code className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {field}
                            </code>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="">
                              <span className="text-muted-foreground text-xs">
                                {t("oldValue")}:
                              </span>
                              <pre className="text-xs mt-1 bg-background p-2 rounded w-full whitespace-pre-wrap break-words">
                                {formatValue(change.oldName ?? change.old)}
                              </pre>
                            </div>
                            <div className="overflow-hidden">
                              <span className="text-muted-foreground text-xs">
                                {t("newValue")}:
                              </span>
                              <pre className="text-xs mt-1 bg-background p-2 rounded w-full whitespace-pre-wrap break-words">
                                {formatValue(change.newName ?? change.new)}
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
              {canViewMetadata &&
                metadata &&
                Object.keys(metadata).length > 0 && (
                  <>
                    <Separator />
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium mb-2">
                        {t("metadata")}
                      </h4>
                      <div>
                        <pre className="text-xs bg-muted p-3 rounded-md whitespace-pre-wrap break-words">
                          {JSON.stringify(metadata, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </>
                )}
            </div>
          </div>
        )}
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

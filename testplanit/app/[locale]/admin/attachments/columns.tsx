import { DateFormatter } from "@/components/DateFormatter";
import { SessionNameDisplay } from "@/components/SessionNameDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { ColumnDef } from "@/components/tables/tableFeatures";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowSelectCheckbox } from "@/components/tables/RowSelectCheckbox";
import { Checkbox } from "@/components/ui/checkbox";
import { filesize } from "filesize";
import { Copy, File, Info, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  fileFormatName,
  LINK_MIME_TYPE,
  type AttachmentParentType,
} from "~/lib/services/adminAttachmentRules";
import type {
  AdminAttachment,
  AttachmentParent,
} from "~/lib/services/adminAttachments";

import {
  AttachmentRowActions,
  type AttachmentActionRequest,
} from "./AttachmentActions";

/** The record an attachment belongs to, drawn the way that record is drawn everywhere else. */
export function AttachedTo({ parent }: { parent: AttachmentParent }) {
  switch (parent.entity) {
    case "case":
      return (
        <CaseDisplay
          id={parent.entityId}
          name={parent.name}
          isDeleted={parent.isDeleted}
          projectId={parent.projectId ?? undefined}
          size="small"
        />
      );
    case "testRun":
      return (
        <TestRunNameDisplay
          testRun={{
            id: parent.entityId,
            name: parent.name,
            isDeleted: parent.isDeleted,
          }}
          projectId={parent.projectId ?? undefined}
          showIcon
          className="truncate"
        />
      );
    case "session":
      return (
        <SessionNameDisplay
          session={{
            id: parent.entityId,
            name: parent.name,
            isDeleted: parent.isDeleted,
          }}
          showIcon
          className="truncate"
        />
      );
    case "issue":
      return (
        <IssuesDisplay
          id={parent.entityId}
          name={parent.name}
          title={parent.title}
          projectIds={parent.projectId ? [parent.projectId] : []}
          size="small"
        />
      );
  }
}

export type AttachmentStatusKey =
  | "live"
  | "softDeleted"
  | "parentDeleted"
  | "noParent"
  | "fileMissing"
  | "otherHost";

/** The one status worth showing for a row, most actionable first. */
export function attachmentStatus(row: AdminAttachment): AttachmentStatusKey {
  if (row.isDeleted) return "softDeleted";
  if (!row.parent) return "noParent";
  if (row.parent.isDeleted) return "parentDeleted";
  return "live";
}

/**
 * Names for what an attachment hangs off and for its status. Most are shared
 * strings; only the ones with no equivalent live under admin.attachments.
 */
export function useAttachmentLabels() {
  const t = useTranslations("admin.attachments");
  const tGlobal = useTranslations();
  return useMemo(
    () => ({
      parent: (type: AttachmentParentType): string => {
        switch (type) {
          case "case":
            return tGlobal("alerts.subjectType.CASE");
          case "testRun":
            return tGlobal("alerts.subjectType.RUN");
          case "session":
            return tGlobal("common.fields.session");
          case "none":
            return tGlobal("common.access.none");
          default:
            return t(`attachedTo.${type}`);
        }
      },
      status: (status: AttachmentStatusKey): string => {
        switch (status) {
          case "live":
            return tGlobal("common.fields.isActive");
          case "softDeleted":
            return tGlobal("common.status.deleted");
          default:
            return t(`status.${status}`);
        }
      },
      mimeType: (mimeType: string): string => {
        if (mimeType === LINK_MIME_TYPE) return tGlobal("common.fields.links");
        return fileFormatName(mimeType) || tGlobal("common.labels.unknown");
      },
    }),
    [t, tGlobal]
  );
}

export const useColumns = (
  userPreferences: {
    user: { preferences: { dateFormat?: string; timezone?: string } };
  },
  t: ReturnType<typeof useTranslations<"admin.attachments">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  onShowSameFile: (attachment: AdminAttachment) => void,
  onShowDetail: (attachment: AdminAttachment) => void,
  onAction: (request: AttachmentActionRequest) => void
): ColumnDef<AdminAttachment>[] => {
  const dateFormat =
    userPreferences.user.preferences?.dateFormat || "MM_DD_YYYY_DASH";
  const timezone = userPreferences.user.preferences?.timezone || "Etc/UTC";
  const tGlobal = useTranslations();
  const labels = useAttachmentLabels();

  return useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected() ||
              (table.getIsSomeRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
            aria-label={tCommon("actions.selectAll")}
            data-testid="attachments-select-all"
          />
        ),
        cell: ({ row, table }) => (
          <RowSelectCheckbox
            row={row}
            table={table}
            aria-label={tCommon("actions.select")}
            data-testid={`attachment-select-${row.original.id}`}
          />
        ),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 40,
      },
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        size: 280,
        cell: ({ row }) => {
          const Icon = row.original.kind === "link" ? Link2 : File;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium" title={row.original.name}>
                {row.original.name}
              </span>
            </div>
          );
        },
      },
      {
        id: "size",
        accessorKey: "size",
        header: tCommon("fields.size"),
        enableSorting: true,
        enableResizing: true,
        size: 130,
        cell: ({ row }) =>
          row.original.kind === "link" ? null : filesize(row.original.size),
      },
      {
        id: "status",
        header: tCommon("actions.status"),
        enableSorting: false,
        enableResizing: true,
        size: 200,
        cell: ({ row }) => {
          const status = attachmentStatus(row.original);
          return (
            <div className="flex min-w-0 items-center gap-1">
              <Badge
                variant={status === "live" ? "secondary" : "outline"}
                data-testid={`attachment-status-${row.original.id}`}
              >
                {labels.status(status)}
              </Badge>
              {row.original.fileMissing && (
                <Badge
                  variant="destructive"
                  data-testid={`attachment-file-missing-${row.original.id}`}
                >
                  {labels.status("fileMissing")}
                </Badge>
              )}
              {row.original.otherHost && (
                <Badge
                  variant="outline"
                  title={row.original.otherHost}
                  data-testid={`attachment-other-host-${row.original.id}`}
                >
                  {labels.status("otherHost")}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "attachedTo",
        header: t("attachedTo.label"),
        enableSorting: false,
        enableResizing: true,
        size: 300,
        cell: ({ row }) => {
          const { parent } = row.original;
          if (!parent) {
            return (
              <span className="text-muted-foreground">
                {labels.parent("none")}
              </span>
            );
          }
          return (
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <AttachedTo parent={parent} />
              </div>
              {parent.type !== parent.entity && (
                <Badge variant="outline" className="shrink-0">
                  {labels.parent(parent.type)}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "project",
        header: tCommon("fields.project"),
        enableSorting: false,
        enableResizing: true,
        size: 180,
        cell: ({ row }) => {
          const { parent } = row.original;
          return parent?.projectId && parent.projectName ? (
            <ProjectNameCell
              value={parent.projectName}
              projectId={parent.projectId}
              size="sm"
            />
          ) : null;
        },
      },
      {
        id: "sharedFile",
        header: t("columns.sharedFile"),
        enableSorting: false,
        enableResizing: true,
        size: 190,
        cell: ({ row }) => {
          const count = row.original.sharedWith;
          if (!count) return null;
          return (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto gap-1.5 p-0"
              title={t("sharedFile.hint", { count })}
              data-testid={`attachment-shared-${row.original.id}`}
              onClick={() => onShowSameFile(row.original)}
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              {t("sharedFile.count", { count })}
            </Button>
          );
        },
      },
      {
        id: "mimeType",
        accessorKey: "mimeType",
        header: tCommon("fields.type"),
        enableSorting: true,
        enableResizing: true,
        size: 160,
        cell: ({ row }) => (
          <span
            className="truncate text-muted-foreground"
            title={row.original.mimeType || undefined}
          >
            {labels.mimeType(row.original.mimeType)}
          </span>
        ),
      },
      {
        id: "uploadedBy",
        header: tCommon("fields.createdBy"),
        enableSorting: false,
        enableResizing: true,
        size: 180,
        cell: ({ row }) =>
          row.original.createdBy ? (
            <UserNameCell userId={row.original.createdBy.id} />
          ) : null,
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: tCommon("fields.created"),
        enableSorting: true,
        enableResizing: true,
        size: 130,
        cell: ({ row }) => (
          <DateFormatter
            date={row.original.createdAt}
            formatString={dateFormat}
            timezone={timezone}
          />
        ),
      },
      {
        id: "note",
        accessorKey: "note",
        header: tCommon("fields.note"),
        enableSorting: false,
        enableResizing: true,
        size: 220,
        cell: ({ row }) =>
          row.original.note ? (
            <span
              className="truncate"
              title={row.original.note}
              data-testid={`attachment-note-${row.original.id}`}
            >
              {row.original.note}
            </span>
          ) : null,
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 140,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1 bg-primary-foreground whitespace-nowrap">
            <Button
              type="button"
              variant="ghost"
              className="h-auto px-2 py-1"
              aria-label={tGlobal("admin.auditLogs.viewDetails")}
              title={tGlobal("admin.auditLogs.viewDetails")}
              data-testid={`attachment-detail-open-${row.original.id}`}
              onClick={() => onShowDetail(row.original)}
            >
              <Info className="h-5 w-5" />
            </Button>
            <AttachmentRowActions
              attachment={row.original}
              onAction={onAction}
            />
          </div>
        ),
      },
    ],
    [
      t,
      tCommon,
      tGlobal,
      labels,
      dateFormat,
      timezone,
      onShowSameFile,
      onShowDetail,
      onAction,
    ]
  );
};

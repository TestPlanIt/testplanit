import SystemOutputPopover from "@/components/junit/SystemOutputPopover";
import SystemErrorPopover from "@/components/junit/SystemErrorPopover";
import { Badge } from "@/components/ui/badge";
import { toHumanReadable } from "~/utils/duration";
import { DateFormatter } from "@/components/DateFormatter";
import { UserNameCell } from "@/components/tables/UserNameCell";
import type { Session } from "next-auth";
import { ListChecks, Bot, LinkIcon } from "lucide-react";
import { Link } from "~/lib/navigation";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";

export function getJunitColumns({
  t,
  session,
  projectId,
}: {
  t: (key: string) => string;
  session: Session | null;
  projectId: string;
}) {
  return [
    {
      id: "name",
      header: t("common.fields.name"),
      accessorKey: "name",
      enableSorting: true,
      enableHiding: false,
      enableResizing: true,
      cell: ({ row }: { row: { original: any } }) => (
        <span className="flex items-center group">
          {isAutomatedCaseSource(row.original.source) ? (
            <Bot className="w-4 h-4 mr-1 text-primary shrink-0" />
          ) : (
            <ListChecks className="w-4 h-4 mr-1 text-primary shrink-0" />
          )}

          <Link
            className="truncate"
            href={`/projects/repository/${projectId}/${row.original.id}`}
          >
            {row.original.name}
          </Link>
          <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </span>
      ),
      maxSize: 500,
      meta: { isPinned: "left" },
    },
    {
      id: "links",
      header: t("common.fields.links") || "Links",
      enableSorting: false,
      enableHiding: true,
      enableResizing: true,
      meta: { isVisible: false },
      size: 120,
      cell: ({ row }: { row: { original: any } }) => {
        const linksFrom = row.original.linksFrom || [];
        const linksTo = row.original.linksTo || [];
        const allLinkedIds = [
          ...linksFrom.map((l: any) => l.caseBId),
          ...linksTo.map((l: any) => l.caseAId),
        ];
        const uniqueLinkedIds = Array.from(new Set(allLinkedIds)).filter(
          (id) => id !== row.original.id
        );
        if (uniqueLinkedIds.length === 0) return null;
        return (
          <CasesListDisplay
            caseIds={uniqueLinkedIds}
            count={uniqueLinkedIds.length}
          />
        );
      },
    },
    {
      id: "id",
      header: t("common.fields.id"),
      accessorKey: "id",
      enableSorting: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      cell: ({ row }: { row: { original: any } }) => (
        <span>{row.original.id}</span>
      ),
      size: 85,
      maxSize: 125,
    },
    {
      id: "suiteName",
      header: t("common.fields.suiteName"),
      accessorKey: "suiteName",
      enableSorting: true,
      cell: ({ row }: { row: { original: any } }) => (
        <span>{row.original.suiteName}</span>
      ),
      size: 200,
    },
    {
      id: "executedAt",
      header: t("common.fields.executedAt"),
      accessorKey: "executedAt",
      enableSorting: true,
      enableHiding: true,
      cell: ({ row }: { row: { original: any } }) =>
        row.original.executedAt ? (
          <DateFormatter
            date={row.original.executedAt}
            formatString={
              session?.user.preferences?.dateFormat +
              " " +
              session?.user.preferences?.timeFormat
            }
            timezone={session?.user.preferences?.timezone}
          />
        ) : null,
      size: 150,
    },
    {
      id: "className",
      header: t("common.fields.className"),
      accessorKey: "className",
      enableSorting: true,
      cell: ({ row }: { row: { original: any } }) => (
        <SystemOutputPopover text={row.original.className} />
      ),
      size: 100,
      maxSize: 250,
    },
    {
      id: "properties",
      header: t("common.fields.properties"),
      accessorKey: "properties",
      enableSorting: false,
      cell: ({ row }: { row: { original: any } }) =>
        Array.isArray(row.original.properties) &&
        row.original.properties.length > 0 ? (
          <ul className="list-disc ml-2">
            {row.original.properties.map((prop: any) => (
              <li key={prop.id}>
                <span>{prop.name}</span>: {prop.value}
              </li>
            ))}
          </ul>
        ) : null,
      size: 200,
    },
    {
      id: "createdAt",
      header: t("common.fields.createdAt"),
      accessorKey: "createdAt",
      enableSorting: true,
      enableHiding: true,
      meta: { isVisible: false },
      cell: ({ row }: { row: { original: any } }) => (
        <DateFormatter
          date={row.original.createdAt}
          formatString={session?.user.preferences?.dateFormat}
          timezone={session?.user.preferences?.timezone}
        />
      ),
      size: 150,
    },
    {
      id: "createdBy",
      header: t("common.fields.createdBy"),
      accessorKey: "createdBy",
      enableSorting: true,
      enableHiding: true,
      meta: { isVisible: false },
      cell: ({ row }: { row: { original: any } }) => (
        <UserNameCell userId={row.original.createdById} />
      ),
      size: 150,
    },
    {
      id: "time",
      header: t("common.fields.duration"),
      accessorKey: "time",
      enableSorting: true,
      cell: ({ row }: { row: { original: any } }) => (
        <span>
          {toHumanReadable(row.original.time, {
            isSeconds: true,
            maxDecimalPoints: 3,
            round: false,
          })}
        </span>
      ),
      size: 80,
    },
    {
      id: "assertions",
      header: t("common.fields.assertions"),
      accessorKey: "assertions",
      enableSorting: true,
      cell: ({ row }: { row: { original: any } }) => row.original.assertions,
      size: 80,
    },
    {
      id: "systemOutput",
      header: t("common.fields.systemOutput"),
      accessorKey: "systemOutput",
      enableSorting: false,
      cell: ({ row }: { row: { original: any } }) => (
        <SystemOutputPopover text={row.original.systemOutput} />
      ),
      size: 200,
    },
    {
      id: "systemError",
      header: t("common.fields.systemError"),
      accessorKey: "systemError",
      enableSorting: false,
      cell: ({ row }: { row: { original: any } }) => (
        <SystemErrorPopover text={row.original.systemError} />
      ),
      size: 200,
    },
    {
      id: "resultStatus",
      header: t("common.fields.resultStatus"),
      accessorKey: "resultStatus",
      enableSorting: true,
      meta: { isPinned: "right" },
      cell: ({ row }: { row: { original: any } }) => (
        <div className="flex items-center justify-end h-full">
          <Badge
            variant="default"
            className="text-primary-foreground font-semibold h-full"
            style={{ backgroundColor: row.original.resultColor }}
          >
            {row.original.resultStatus}
          </Badge>
        </div>
      ),
      size: 120,
    },
  ];
}

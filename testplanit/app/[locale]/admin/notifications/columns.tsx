import { DateFormatter } from "@/components/DateFormatter";
import { UserDisplay } from "@/components/search/UserDisplay";
import TextFromJson from "@/components/TextFromJson";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";

export interface NotificationHistoryItem {
  id: number | string;
  name: string;
  title: string;
  message: string;
  createdAt: Date | string;
  data?: {
    richContent?: object | string;
    htmlContent?: string;
    sentById?: string;
    sentByName?: string;
  };
}

export const getColumns = (
  userPreferences: { user: { preferences: { dateFormat?: string; timezone?: string; timeFormat?: string } } },
  t: ReturnType<typeof useTranslations<"admin.notifications">>,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<NotificationHistoryItem>[] => [
  {
    id: "title",
    accessorKey: "title",
    header: tCommon("fields.title"),
    enableSorting: false,
    enableResizing: true,
    size: 250,
    minSize: 100,
    maxSize: 500,
    cell: ({ getValue, column }) => {
      const title = getValue() as string;
      const columnWidth = column.getSize();
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="font-medium truncate block"
                style={{ maxWidth: columnWidth - 20 }}
              >
                {title}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{title}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    id: "message",
    accessorKey: "message",
    header: tCommon("actions.automated.message"),
    enableSorting: false,
    enableResizing: true,
    size: 400,
    minSize: 150,
    maxSize: 800,
    cell: ({ row, column }) => {
      const notification = row.original;
      const columnWidth = column.getSize();
      const richContent = notification.data?.richContent;
      const htmlContent = notification.data?.htmlContent;
      const message = notification.message;

      // Determine content type: TipTap JSON object, HTML string (from richContent, htmlContent, or message)
      const isTipTapJson =
        richContent && typeof richContent === "object" && "type" in richContent;

      // Check for HTML content in richContent, htmlContent, or message field
      const htmlSource =
        typeof richContent === "string" &&
        (richContent.startsWith("<") || richContent.includes("</"))
          ? richContent
          : htmlContent
            ? htmlContent
            : message && (message.startsWith("<") || message.includes("</"))
              ? message
              : null;

      const renderContent = (isPreview: boolean) => {
        if (isTipTapJson) {
          return (
            <div className="text-sm text-muted-foreground">
              <TextFromJson
                jsonString={JSON.stringify(richContent)}
                format="html"
                room={`notification-history-${isPreview ? "preview" : "full"}-${notification.id}`}
                expand={!isPreview}
                expandable={false}
              />
            </div>
          );
        }
        if (htmlSource) {
          return (
            <div
              className={
                isPreview
                  ? "text-sm text-muted-foreground line-clamp-2"
                  : "text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold prose-a:text-primary prose-a:underline"
              }
              dangerouslySetInnerHTML={{ __html: htmlSource }}
            />
          );
        }
        // Plain text fallback
        return (
          <span
            className={isPreview ? "truncate block" : "whitespace-pre-wrap"}
          >
            {message}
          </span>
        );
      };

      return (
        <Popover>
          <PopoverTrigger asChild>
            <div
              className="max-h-16 overflow-hidden cursor-pointer hover:bg-muted/50 rounded p-1 -m-1"
              style={{ maxWidth: columnWidth - 20 }}
            >
              {renderContent(true)}
            </div>
          </PopoverTrigger>
          <PopoverContent
            className="w-[500px] max-w-[90vw]"
            side="bottom"
            align="start"
          >
            <div className="max-h-[400px] overflow-y-auto">
              {renderContent(false)}
            </div>
          </PopoverContent>
        </Popover>
      );
    },
  },
  {
    id: "sentBy",
    accessorKey: "data.sentByName",
    header: t("systemNotification.history.sentBy"),
    enableSorting: false,
    size: 180,
    cell: ({ row }) => (
      <UserDisplay
        userId={row.original.data?.sentById}
        userName={row.original.data?.sentByName || "Administrator"}
      />
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: t("systemNotification.history.sentAt"),
    enableSorting: false,
    size: 180,
    cell: ({ getValue }) => {
      const date = getValue() as Date | string;
      const timezone = userPreferences?.user?.preferences?.timezone || "Etc/UTC";
      const dateFormat =
        userPreferences?.user?.preferences?.dateFormat || "MM_DD_YYYY_DASH";
      const timeFormat = userPreferences?.user?.preferences?.timeFormat || "HH_MM_24";
      return (
        <div className="whitespace-nowrap text-sm cursor-default">
          <DateFormatter
            date={date}
            formatString={`${dateFormat} ${timeFormat}`}
            timezone={timezone}
          />
        </div>
      );
    },
  },
];

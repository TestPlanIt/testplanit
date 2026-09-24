"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Bookmark } from "lucide-react";
import { SAVED_REPORT_ENTITY_TYPE } from "~/hooks/useSavedReports";
import { schema } from "~/zenstack/schema";

/**
 * Names the saved report on screen: its title and description above the
 * results, while the builder still shows the report exactly as it was opened
 * from the Saved Reports menu (`?savedReport=<id>`).
 */
export function SavedReportContext({
  savedReportId,
}: {
  savedReportId: string;
}) {
  const { data: savedReport } = useClientQueries(schema).shareLink.useFindFirst(
    {
      where: {
        id: savedReportId,
        entityType: SAVED_REPORT_ENTITY_TYPE,
        isDeleted: false,
      },
      select: { title: true, description: true },
    }
  );

  if (!savedReport?.title) return null;

  return (
    <div
      className="flex items-center gap-2 border-b px-6 py-3"
      data-testid="saved-report-context"
    >
      <Bookmark className="mt-0.5 h-4 w-4 shrink-0 fill-primary text-primary" />
      <div className="min-w-0">
        <p className="truncate font-medium">{savedReport.title}</p>
        {savedReport.description && (
          <p className="text-sm whitespace-pre-line text-muted-foreground">
            {savedReport.description}
          </p>
        )}
      </div>
    </div>
  );
}

import { DatabaseArrowUp, Share2 } from "lucide-react";
import React from "react";

import { cn, type ClassValue } from "~/utils";

interface DatasetNameDisplayProps {
  name: string;
  /**
   * `true` for project-scoped shared datasets (assignable to many cases via
   * `CaseSharedDataSetAssignment`); `false` for owner-bound datasets that
   * live with a single case via `DataSet.ownerCaseId`.
   *
   * The icon is the only signal users have to disambiguate two datasets
   * that share a name — owner-bound and shared datasets live in the same
   * `DataSet` table with no unique-name constraint.
   */
  isShared: boolean;
  /**
   * Optional case name to surface in a tooltip on the icon for owner-bound
   * datasets — lets users disambiguate two same-named owner datasets without
   * leaving the picker. Ignored when `isShared` is true.
   */
  ownerCaseName?: string | null;
  iconClassName?: ClassValue;
  nameClassName?: ClassValue;
  className?: ClassValue;
}

/**
 * Consistent dataset-name + type-icon row used wherever the app lists
 * datasets (filter pickers, assignment dialogs, project settings).
 *
 * Mirrors the pattern of `StatusDisplay` — a tiny presentation
 * component so all surfaces show the same icon for the same dataset
 * type, and a future icon swap is a one-file change.
 */
const DatasetNameDisplay: React.FC<DatasetNameDisplayProps> = ({
  name,
  isShared,
  ownerCaseName,
  iconClassName = "h-4 w-4 shrink-0 text-muted-foreground",
  nameClassName = "truncate",
  className = "flex items-center gap-2 min-w-0",
}) => {
  const Icon = isShared ? Share2 : DatabaseArrowUp;
  // Native `title` attribute (vs Radix Tooltip) because this component is
  // often rendered inside cmdk items / popover content whose pointer-event
  // handling swallows Radix tooltip hover events.
  const titleText = !isShared && ownerCaseName ? ownerCaseName : undefined;
  return (
    <div className={cn(className)}>
      <span className="flex shrink-0" title={titleText}>
        <Icon className={cn(iconClassName)} />
      </span>
      <span className={cn(nameClassName)}>{name}</span>
    </div>
  );
};

export default DatasetNameDisplay;

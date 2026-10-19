import {
  Bot,
  Bug,
  Calendar,
  ChevronsUpDown,
  CircleCheckBig,
  Hash,
  LayoutTemplate,
  Link,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  MessageSquareWarning,
  Paperclip,
  Pin,
  SquareCheckBig,
  SquareStack,
  Tags,
  Type,
  User,
  UserCog,
  Workflow,
} from "lucide-react";

import {
  chipOperatorLabelKey,
  DIMENSION_LABEL_KEYS,
  editorOperatorLabelKey,
} from "~/lib/repository/filterDimensionLabels";
import { type FilterDimension } from "~/lib/repository/filterDimensions";

/**
 * Presentation metadata for filter dimensions. The registry
 * (lib/repository/filterDimensions.ts) stays UI-free so it remains importable
 * from server routes; icons live here and label keys in
 * lib/repository/filterDimensionLabels.ts, which the worker shares. Icons and
 * labels match the ViewSelector axis items so the Add-filter picker reads the
 * same as the "View by" dropdown.
 */

export interface DimensionPresentation {
  icon: LucideIcon;
  labelKey: string;
}

const DIMENSION_ICONS: Readonly<Record<string, LucideIcon>> = {
  templates: LayoutTemplate,
  states: Workflow,
  creators: User,
  automated: Bot,
  parameterized: SquareStack,
  attachments: Paperclip,
  codePins: Pin,
  inReview: MessageSquareWarning,
  tags: Tags,
  issues: Bug,
  status: CircleCheckBig,
  assignedTo: UserCog,
};

export const DIMENSION_PRESENTATION: Readonly<
  Record<string, DimensionPresentation>
> = Object.fromEntries(
  Object.entries(DIMENSION_ICONS).map(([key, icon]) => [
    key,
    { icon, labelKey: DIMENSION_LABEL_KEYS[key] },
  ])
);

const DYNAMIC_FIELD_TYPE_ICONS: Readonly<Record<string, LucideIcon>> = {
  Dropdown: ChevronsUpDown,
  "Multi-Select": ListChecks,
  Link: Link,
  Steps: ListOrdered,
  Checkbox: SquareCheckBig,
  Integer: Hash,
  Number: Hash,
  Date: Calendar,
  "Text Long": Type,
  "Text String": Type,
};

export function getDimensionIcon(dimension: FilterDimension): LucideIcon {
  return (
    DIMENSION_PRESENTATION[dimension.key]?.icon ??
    (dimension.fieldType
      ? DYNAMIC_FIELD_TYPE_ICONS[dimension.fieldType]
      : undefined) ??
    Type
  );
}

/**
 * Localized dimension label. System dimensions map to existing i18n keys;
 * dynamic-field dimensions use the field displayName supplied by the caller,
 * keyed by dimension key (e.g. `field_12`).
 */
export function getDimensionLabel(
  dimension: FilterDimension,
  t: (key: string) => string,
  dynamicFieldLabels?: Readonly<Record<string, string>>
): string {
  const preset = DIMENSION_PRESENTATION[dimension.key];
  if (preset) return t(preset.labelKey);
  return dynamicFieldLabels?.[dimension.key] ?? dimension.key;
}

export { chipOperatorLabelKey, editorOperatorLabelKey };

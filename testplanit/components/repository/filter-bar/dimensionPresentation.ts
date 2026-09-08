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
  SquareCheckBig,
  SquareStack,
  Tags,
  Type,
  User,
  UserCog,
  Workflow,
} from "lucide-react";

import { type FilterDimension } from "~/lib/repository/filterDimensions";

/**
 * Presentation metadata for filter dimensions. The registry
 * (lib/repository/filterDimensions.ts) stays UI-free so it remains importable
 * from server routes; icons and label keys live here instead. Icons and
 * labels match the ViewSelector axis items so the Add-filter picker reads the
 * same as the "View by" dropdown.
 */

export interface DimensionPresentation {
  icon: LucideIcon;
  labelKey: string;
}

export const DIMENSION_PRESENTATION: Readonly<
  Record<string, DimensionPresentation>
> = {
  templates: { icon: LayoutTemplate, labelKey: "common.fields.template" },
  states: { icon: Workflow, labelKey: "common.fields.state" },
  creators: { icon: User, labelKey: "reports.dimensions.creator" },
  automated: { icon: Bot, labelKey: "repository.views.byAutomation" },
  parameterized: {
    icon: SquareStack,
    labelKey: "repository.views.byParameterized",
  },
  attachments: { icon: Paperclip, labelKey: "repository.views.byAttachments" },
  inReview: {
    icon: MessageSquareWarning,
    labelKey: "repository.views.byReview",
  },
  tags: { icon: Tags, labelKey: "repository.views.byTag" },
  issues: { icon: Bug, labelKey: "repository.views.byIssue" },
  status: { icon: CircleCheckBig, labelKey: "common.actions.status" },
  assignedTo: { icon: UserCog, labelKey: "common.fields.assignedTo" },
};

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

/**
 * Label key for an operator as shown on a chip. Bare `any`/`none` (no values)
 * read as has-value / is-empty; with values they read as any-of / none-of
 * (spec §5).
 */
export function chipOperatorLabelKey(
  operator: string,
  valueCount: number
): string {
  if (operator === "any") {
    return valueCount === 0
      ? "common.operators.hasValue"
      : "common.operators.anyOf";
  }
  if (operator === "none") {
    return valueCount === 0
      ? "common.operators.isEmpty"
      : "common.operators.noneOf";
  }
  if (operator === "all") return "common.operators.allOf";
  return `common.operators.${operator}`;
}

/**
 * Label key for an operator inside the chip editor's operator Select, where
 * the value list sits directly below — `any`/`none` always read as
 * any-of / none-of there (bare-ness is emergent from an empty selection).
 */
export function editorOperatorLabelKey(operator: string): string {
  switch (operator) {
    case "any":
      return "common.operators.anyOf";
    case "all":
      return "common.operators.allOf";
    case "none":
      return "common.operators.noneOf";
    default:
      return `common.operators.${operator}`;
  }
}

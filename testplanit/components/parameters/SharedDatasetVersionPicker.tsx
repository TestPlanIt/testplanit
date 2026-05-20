"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useFindManyDataSetVersion } from "~/lib/hooks";

export type SharedDatasetVersionPickerMode = "editor" | "picker";

export type SharedDatasetVersionPickerValue =
  | { id: number; version: number }
  | "current";

export interface SharedDatasetVersionPickerProps {
  dataSetId: number;
  /**
   * Selected value. In `picker` mode, "current" is never a valid value
   * — see the `mode` table below.
   */
  value: SharedDatasetVersionPickerValue;
  onChange: (next: SharedDatasetVersionPickerValue) => void;
  disabled?: boolean;
  /**
   * Operating mode (defaults to "editor"):
   *
   * - "editor" (Plan 04-05) — items are "current" plus each historical
   *   version. Selecting "current" switches the editor between live
   *   editable view and a read-only historical view.
   * - "picker" (Plan 04-06 assignment dialog) — items are historical
   *   versions only. The "current" item is structurally absent because
   *   the assignment dialog has its own "pin to current" radio.
   *
   * The component itself filters its items based on `mode`; consumers
   * never need to filter.
   */
  mode?: SharedDatasetVersionPickerMode;
}

interface VersionRow {
  id: number;
  version: number;
  createdAt: Date | string;
  rowCount: number;
  createdBy: { name: string | null; email?: string } | null;
}

const CURRENT_SENTINEL = "__current__";

export function SharedDatasetVersionPicker({
  dataSetId,
  value,
  onChange,
  disabled,
  mode = "editor",
}: SharedDatasetVersionPickerProps) {
  const t = useTranslations("projects.settings.datasets.versionPicker");

  const { data: versions, isLoading } = useFindManyDataSetVersion({
    where: { dataSetId },
    orderBy: { version: "desc" },
    take: 50,
    select: {
      id: true,
      version: true,
      createdAt: true,
      rowCount: true,
      createdBy: { select: { name: true } },
    },
  });

  const items = useMemo(() => {
    return ((versions ?? []) as unknown as VersionRow[]).map((v) => ({
      ...v,
      createdAt: new Date(v.createdAt as string),
    }));
  }, [versions]);

  const selectValue = value === "current" ? CURRENT_SENTINEL : String(value.id);

  const handleSelectChange = (next: string) => {
    if (next === CURRENT_SENTINEL) {
      onChange("current");
      return;
    }
    const found = items.find((v) => String(v.id) === next);
    if (!found) return;
    onChange({ id: found.id, version: found.version });
  };

  const renderTriggerLabel = () => {
    if (value === "current") {
      const latest = items[0];
      return latest
        ? t("currentItemLabel", { version: latest.version })
        : t("currentItemInitialLabel");
    }
    return t("historicalItemLabel", { version: value.version });
  };

  return (
    <Select
      value={selectValue}
      onValueChange={handleSelectChange}
      disabled={disabled || isLoading}
    >
      <SelectTrigger
        data-testid="shared-dataset-version-picker"
        data-mode={mode}
        className="w-[260px]"
        aria-label={t("label")}
      >
        <SelectValue placeholder={t("label")}>
          {renderTriggerLabel()}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {mode === "editor" ? (
          <SelectItem
            value={CURRENT_SENTINEL}
            data-testid="shared-dataset-version-picker-item-current"
          >
            {items.length > 0
              ? t("currentItemLabel", { version: items[0].version })
              : t("currentItemInitialLabel")}
          </SelectItem>
        ) : null}
        {items.length === 0 && mode === "picker" ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {t("noVersionsYet")}
          </div>
        ) : null}
        {items.map((v) => (
          <SelectItem
            key={v.id}
            value={String(v.id)}
            data-testid={`shared-dataset-version-picker-item-${v.id}`}
          >
            <span>{t("historicalItemLabel", { version: v.version })}</span>
            {v.createdBy?.name ? (
              // No color override and no opacity dim — both compose
              // poorly against the SelectItem's focus state (the
              // highlighted row flips to `bg-accent` + `text-accent-foreground`,
              // a light-bg / dark-text pair in dark theme; mixing dark
              // text with the light bg via opacity produces a mid-gray
              // that drops below readable contrast). Visual hierarchy
              // for the subtext comes from font size + `ml-2` spacing.
              <span className="text-sm ml-2">
                {t("historicalItemBy", { name: v.createdBy.name })}
              </span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

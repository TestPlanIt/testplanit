"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

export interface StaticInputRow {
  key: string;
  value: string;
}

interface StaticInputsEditorProps {
  rows: StaticInputRow[];
  onChange: (rows: StaticInputRow[]) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}

/**
 * Key/value rows for a target's static CI inputs. Kept as rows (not a map)
 * while editing so a half-typed key does not collapse into another entry.
 */
export function StaticInputsEditor({
  rows,
  onChange,
  disabled,
  testIdPrefix = "automation-target-input",
}: StaticInputsEditorProps) {
  const t = useTranslations("automation.settings");

  const update = (index: number, patch: Partial<StaticInputRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}s`}>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={row.key}
            onChange={(e) => update(index, { key: e.target.value })}
            placeholder={t("inputKey")}
            aria-label={t("inputKey")}
            disabled={disabled}
            className="font-mono text-sm"
            data-testid={`${testIdPrefix}-key-${index}`}
          />
          <Input
            value={row.value}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder={t("inputValue")}
            aria-label={t("inputValue")}
            disabled={disabled}
            className="font-mono text-sm"
            data-testid={`${testIdPrefix}-value-${index}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={t("removeInput")}
            data-testid={`${testIdPrefix}-remove-${index}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows, { key: "", value: "" }])}
        data-testid={`${testIdPrefix}-add`}
      >
        <Plus className="h-4 w-4" />
        <span>{t("addInput")}</span>
      </Button>
    </div>
  );
}

export function rowsToInputs(rows: StaticInputRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) out[key] = row.value;
  }
  return out;
}

export function inputsToRows(inputs: Record<string, string>): StaticInputRow[] {
  return Object.entries(inputs).map(([key, value]) => ({ key, value }));
}

"use client";

import { Plus, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Inline parameter + dataset editor for the AddCase modal.
 *
 * Intentionally a separate, simpler component from `ConfigureParametersSheet`
 * + `ParametersTab` + `DatasetTab`. Those are persistence-bound (every edit
 * POSTs to per-case endpoints), and AddCase has no caseId until Save. The
 * trade-off we accept here is that this editor reimplements about 20% of the
 * full sheet's surface — sufficient to author a parameterized case in one
 * step.
 *
 * Gaps vs the full sheet (intentional, can be added later):
 *   - No CSV import (use the live sheet on an existing case for bulk import).
 *   - No per-cell sensitive masking (sensitive is a parameter-level flag).
 *   - SELECT type is offered but `allowedValuesJson` authoring is deferred —
 *     pick the type, fill in allowed values via the live sheet after save.
 *   - No row drag-reorder; rows render in `rowIndex` order.
 *
 * Controlled component: parent owns the parameters + rows state, typically
 * through react-hook-form. `onChange` is invoked with the next combined
 * state on every edit so duplicate-name validation + dependent UI re-renders
 * happen at the parent level.
 */

export type InlineParameterType = "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";

export interface InlineParameter {
  name: string;
  type: InlineParameterType;
  required?: boolean;
  sensitive?: boolean;
  description?: string;
}

export interface InlineDatasetRow {
  rowIndex: number;
  label?: string;
  values: Record<string, unknown>;
}

export interface InlineDatasetEditorProps {
  parameters: InlineParameter[];
  rows: InlineDatasetRow[];
  onChange: (next: {
    parameters: InlineParameter[];
    rows: InlineDatasetRow[];
  }) => void;
  testIdPrefix?: string;
}

const TYPES: InlineParameterType[] = ["STRING", "INTEGER", "BOOLEAN", "SELECT"];

export function InlineDatasetEditor({
  parameters,
  rows,
  onChange,
  testIdPrefix = "inline-dataset",
}: InlineDatasetEditorProps) {
  const t = useTranslations("parameters");

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of parameters) {
      const key = p.name.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, c]) => c > 1)
        .map(([k]) => k)
    );
  }, [parameters]);

  const updateParameter = useCallback(
    (index: number, patch: Partial<InlineParameter>) => {
      const next = parameters.map((p, i) =>
        i === index ? { ...p, ...patch } : p
      );
      onChange({ parameters: next, rows });
    },
    [parameters, rows, onChange]
  );

  const renameParameter = useCallback(
    (index: number, nextName: string) => {
      const prevName = parameters[index]?.name;
      const nextParams = parameters.map((p, i) =>
        i === index ? { ...p, name: nextName } : p
      );
      // Cascade rename into row values so entered data isn't lost on typo
      // fixes.
      const nextRows = rows.map((row) => {
        if (prevName === undefined || prevName === nextName) return row;
        if (!(prevName in row.values)) return row;
        const { [prevName]: moved, ...rest } = row.values;
        return { ...row, values: { ...rest, [nextName]: moved } };
      });
      onChange({ parameters: nextParams, rows: nextRows });
    },
    [parameters, rows, onChange]
  );

  const removeParameter = useCallback(
    (index: number) => {
      const removed = parameters[index]?.name;
      const nextParams = parameters.filter((_, i) => i !== index);
      const nextRows = removed
        ? rows.map((r) => {
            const { [removed]: _drop, ...rest } = r.values;
            return { ...r, values: rest };
          })
        : rows;
      onChange({ parameters: nextParams, rows: nextRows });
    },
    [parameters, rows, onChange]
  );

  const addParameter = useCallback(() => {
    const taken = new Set(parameters.map((p) => p.name));
    let candidate = "param";
    let counter = 1;
    while (taken.has(candidate)) {
      counter += 1;
      candidate = `param${counter}`;
    }
    onChange({
      parameters: [
        ...parameters,
        { name: candidate, type: "STRING", required: false, sensitive: false },
      ],
      rows,
    });
  }, [parameters, rows, onChange]);

  const addRow = useCallback(() => {
    const nextIndex = rows.length
      ? Math.max(...rows.map((r) => r.rowIndex)) + 1
      : 0;
    const blankValues: Record<string, unknown> = {};
    for (const p of parameters) {
      blankValues[p.name] = p.type === "BOOLEAN" ? false : "";
    }
    onChange({
      parameters,
      rows: [...rows, { rowIndex: nextIndex, label: "", values: blankValues }],
    });
  }, [parameters, rows, onChange]);

  const removeRow = useCallback(
    (index: number) => {
      onChange({ parameters, rows: rows.filter((_, i) => i !== index) });
    },
    [parameters, rows, onChange]
  );

  const updateRowLabel = useCallback(
    (index: number, label: string) => {
      const next = rows.map((r, i) => (i === index ? { ...r, label } : r));
      onChange({ parameters, rows: next });
    },
    [parameters, rows, onChange]
  );

  const updateRowValue = useCallback(
    (rowIdx: number, paramName: string, value: unknown) => {
      const next = rows.map((r, i) =>
        i === rowIdx ? { ...r, values: { ...r.values, [paramName]: value } } : r
      );
      onChange({ parameters, rows: next });
    },
    [parameters, rows, onChange]
  );

  return (
    <div className="space-y-4" data-testid={`${testIdPrefix}-root`}>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("tabParameters")}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addParameter}
            data-testid={`${testIdPrefix}-add-parameter`}
          >
            <Plus className="me-1 h-3.5 w-3.5" />
            {t("formAdd")}
          </Button>
        </div>
        {parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyHeading")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">{t("formName")}</TableHead>
                <TableHead className="w-[18%]">{t("formType")}</TableHead>
                <TableHead className="w-[15%] text-center">
                  {t("formRequired")}
                </TableHead>
                <TableHead className="w-[15%] text-center">
                  {t("formSensitive")}
                </TableHead>
                <TableHead className="w-auto" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {parameters.map((p, i) => {
                const isDup = duplicateNames.has(p.name.trim());
                return (
                  <TableRow
                    key={i}
                    data-testid={`${testIdPrefix}-parameter-row-${i}`}
                  >
                    <TableCell>
                      <Input
                        value={p.name}
                        onChange={(e) => renameParameter(i, e.target.value)}
                        aria-invalid={isDup || !p.name.trim()}
                        className={isDup ? "border-destructive" : undefined}
                        data-testid={`${testIdPrefix}-parameter-name-${i}`}
                      />
                      {isDup && (
                        <p className="mt-1 text-xs text-destructive">
                          {t("datasetAddColumnDuplicate")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={p.type}
                        onValueChange={(v) =>
                          updateParameter(i, {
                            type: v as InlineParameterType,
                          })
                        }
                      >
                        <SelectTrigger
                          data-testid={`${testIdPrefix}-parameter-type-${i}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TYPES.map((typ) => (
                            <SelectItem key={typ} value={typ}>
                              {typ}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!!p.required}
                        onCheckedChange={(checked) =>
                          updateParameter(i, { required: checked })
                        }
                        aria-label={t("formRequired")}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!!p.sensitive}
                        onCheckedChange={(checked) =>
                          updateParameter(i, { sensitive: checked })
                        }
                        aria-label={t("formSensitive")}
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeParameter(i)}
                        aria-label={t("deleteAria")}
                        data-testid={`${testIdPrefix}-remove-parameter-${i}`}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("tabDataset")}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={parameters.length === 0}
            data-testid={`${testIdPrefix}-add-row`}
          >
            <Plus className="me-1 h-3.5 w-3.5" />
            {t("datasetAddRow")}
          </Button>
        </div>
        {parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("tabDatasetDisabledTooltip")}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("datasetEmptyHeading")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[20%]">
                  {t("datasetLabelColumn")}
                </TableHead>
                {parameters.map((p, i) => (
                  <TableHead key={`${p.name}-${i}`}>{p.name || "—"}</TableHead>
                ))}
                <TableHead className="w-auto" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, rowIdx) => (
                <TableRow
                  key={rowIdx}
                  data-testid={`${testIdPrefix}-dataset-row-${rowIdx}`}
                >
                  <TableCell>
                    <Input
                      value={row.label ?? ""}
                      onChange={(e) => updateRowLabel(rowIdx, e.target.value)}
                      data-testid={`${testIdPrefix}-row-label-${rowIdx}`}
                    />
                  </TableCell>
                  {parameters.map((p, colIdx) => {
                    const raw = row.values[p.name];
                    const cellTestId = `${testIdPrefix}-row-${rowIdx}-col-${colIdx}`;
                    if (p.type === "BOOLEAN") {
                      return (
                        <TableCell key={`${p.name}-${colIdx}`}>
                          <Switch
                            checked={raw === true}
                            onCheckedChange={(checked) =>
                              updateRowValue(rowIdx, p.name, checked)
                            }
                            aria-label={p.name}
                            data-testid={cellTestId}
                          />
                        </TableCell>
                      );
                    }
                    if (p.type === "INTEGER") {
                      return (
                        <TableCell key={`${p.name}-${colIdx}`}>
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={raw == null ? "" : String(raw)}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "") {
                                updateRowValue(rowIdx, p.name, "");
                              } else {
                                const parsed = Number(val);
                                updateRowValue(
                                  rowIdx,
                                  p.name,
                                  Number.isFinite(parsed) ? parsed : val
                                );
                              }
                            }}
                            data-testid={cellTestId}
                          />
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={`${p.name}-${colIdx}`}>
                        <Input
                          value={raw == null ? "" : String(raw)}
                          onChange={(e) =>
                            updateRowValue(rowIdx, p.name, e.target.value)
                          }
                          data-testid={cellTestId}
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(rowIdx)}
                      aria-label={t("deleteAria")}
                      data-testid={`${testIdPrefix}-remove-row-${rowIdx}`}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";

export interface MapColumnsStepParameter {
  name: string;
  required: boolean;
}

export interface MapColumnsStepProps {
  csvHeaders: string[];
  parameters: MapColumnsStepParameter[];
  /** csvHeader -> paramName | "__skip__" */
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  onValidityChange: (valid: boolean) => void;
}

const SKIP_VALUE = "__skip__";

/**
 * Surface E.3 — Step 2 (Map columns).
 *
 * Auto-maps CSV headers to declared parameter names case-insensitively
 * on first render when no mapping has been provided yet. Renders a
 * warning ribbon for any required parameter that has no mapped CSV
 * column and propagates the validity flag to the wizard shell so the
 * Next button can be disabled.
 */
export function MapColumnsStep({
  csvHeaders,
  parameters,
  mapping,
  onMappingChange,
  onValidityChange,
}: MapColumnsStepProps) {
  const t = useTranslations("parameters");
  const autoMappedRef = useRef(false);

  // Auto-map once on mount if mapping is empty.
  useEffect(() => {
    if (autoMappedRef.current) return;
    if (Object.keys(mapping).length > 0) {
      autoMappedRef.current = true;
      return;
    }
    if (csvHeaders.length === 0) return;
    const initial: Record<string, string> = {};
    csvHeaders.forEach((h) => {
      const match = parameters.find(
        (p) => p.name.toLowerCase() === h.toLowerCase()
      );
      initial[h] = match ? match.name : SKIP_VALUE;
    });
    autoMappedRef.current = true;
    onMappingChange(initial);
  }, [csvHeaders, parameters, mapping, onMappingChange]);

  const unmappedRequired = useMemo(() => {
    const mappedParams = new Set(Object.values(mapping));
    return parameters.filter((p) => p.required && !mappedParams.has(p.name));
  }, [mapping, parameters]);

  useEffect(() => {
    onValidityChange(unmappedRequired.length === 0);
  }, [unmappedRequired, onValidityChange]);

  return (
    <div className="p-6 space-y-4" data-testid="dataset-import-wizard-step-map">
      <h3 className="text-base font-semibold">{t("importStep2Heading")}</h3>

      {unmappedRequired.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 text-xs rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          data-testid="dataset-import-wizard-map-warning"
        >
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            {unmappedRequired.map((p) => (
              <div key={p.name}>
                {t("importStep2RequiredUnmapped", { name: p.name })}
              </div>
            ))}
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("importStep2HeaderCsv")}</TableHead>
            <TableHead>{t("importStep2HeaderParameter")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {csvHeaders.map((h) => (
            <TableRow
              key={h}
              data-testid={`dataset-import-wizard-map-row-${h}`}
            >
              <TableCell className="font-mono">{h}</TableCell>
              <TableCell>
                <Select
                  value={mapping[h] ?? SKIP_VALUE}
                  onValueChange={(v) => onMappingChange({ ...mapping, [h]: v })}
                >
                  <SelectTrigger
                    data-testid={`dataset-import-wizard-map-select-${h}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP_VALUE}>
                      {t("importStep2SkipColumn")}
                    </SelectItem>
                    {parameters.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.name}
                        {p.required ? " *" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

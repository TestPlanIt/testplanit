"use client";

import { SharedDatasetMappingFields } from "@/components/parameters/SharedDatasetMappingFields";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { SharedDatasetVersionPicker } from "@/components/parameters/SharedDatasetVersionPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "~/lib/navigation";
import { SKIP_SENTINEL } from "~/lib/utils/datasetMapping";

export interface AssignSharedDatasetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  projectId: number;
  /**
   * When true, render the Amendment-A info banner explaining that
   * iteration continues to use local rows until the local dataset is
   * removed. The save flow is unchanged.
   */
  hasOwnerDataset: boolean;
  /**
   * When provided, the dialog opens prefilled for an "edit assignment"
   * flow. `null` / undefined means "create a new assignment".
   */
  currentAssignment?: {
    sharedDataSetId: number;
    pinnedVersionId: number | null;
    mappingJson: Record<string, string>;
  } | null;
  onSaved?: () => void;
}

interface DataSetRow {
  id: number;
  name: string;
}

interface VersionShape {
  id: number;
  version: number;
  parametersJson: unknown;
  rowsJson: unknown;
}

type PinMode = "current" | "follow-latest" | "specific";

/**
 * Derive the column name set for a `DataSetVersion` payload. Mirrors the
 * server-side helper in `app/api/repository/cases/[caseId]/shared-dataset/route.ts`
 * but lives client-side so the assignment dialog can render mapping rows
 * before the user clicks Save.
 */
function deriveVersionColumns(version: VersionShape | null): string[] {
  if (!version) return [];
  const params = version.parametersJson;
  if (Array.isArray(params)) {
    const out: string[] = [];
    for (const entry of params) {
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).name === "string"
      ) {
        out.push(String((entry as Record<string, unknown>).name));
      }
    }
    if (out.length > 0) return out;
  }
  const rows = version.rowsJson;
  if (Array.isArray(rows) && rows.length > 0) {
    const first = rows[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const valuesJson = (first as Record<string, unknown>).valuesJson;
      if (
        valuesJson &&
        typeof valuesJson === "object" &&
        !Array.isArray(valuesJson)
      ) {
        return Object.keys(valuesJson as Record<string, unknown>);
      }
      return Object.keys(first as Record<string, unknown>).filter(
        (k) => k !== "label" && k !== "rowIndex" && k !== "id"
      );
    }
  }
  return [];
}

export function AssignSharedDatasetDialog({
  open,
  onOpenChange,
  caseId,
  projectId,
  hasOwnerDataset,
  currentAssignment,
  onSaved,
}: AssignSharedDatasetDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  // ---------- Section 1 — Choose dataset ----------
  const { data: datasetsRaw, isLoading: datasetsLoading } = useClientQueries(schema).dataSet.useFindMany(
    {
      where: { projectId, isShared: true, isDeleted: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    },
    { enabled: open }
  );
  const datasets = (datasetsRaw ?? []) as unknown as DataSetRow[];

  const [selectedDataSetId, setSelectedDataSetId] = useState<number | null>(
    currentAssignment?.sharedDataSetId ?? null
  );

  // ---------- Section 2 — Pin version ----------
  // Default: "current" (locked decision, RESEARCH.md Pitfall 5).
  const initialPinMode: PinMode = currentAssignment
    ? currentAssignment.pinnedVersionId === null
      ? "follow-latest"
      : "specific"
    : "current";
  const [pinMode, setPinMode] = useState<PinMode>(initialPinMode);
  const [specificVersion, setSpecificVersion] = useState<{
    id: number;
    version: number;
  } | null>(null);

  // ---------- Section 3 — Mapping ----------
  const [mapping, setMapping] = useState<Record<string, string>>(
    currentAssignment?.mappingJson ?? {}
  );
  const [mappingValid, setMappingValid] = useState(false);

  // Reset state whenever the dialog re-opens with potentially different
  // currentAssignment props. Avoids stale state bleeding between cases.
  useEffect(() => {
    if (!open) return;
    setSelectedDataSetId(currentAssignment?.sharedDataSetId ?? null);
    setPinMode(
      currentAssignment
        ? currentAssignment.pinnedVersionId === null
          ? "follow-latest"
          : "specific"
        : "current"
    );
    setSpecificVersion(null);
    setMapping(currentAssignment?.mappingJson ?? {});
    setMappingValid(false);
    setErrorBanner(null);
    setSubmitting(false);
  }, [open, currentAssignment]);

  // Resolve the version whose columns we should map against:
  //   - "current" / "follow-latest" → latest version of the selected dataset
  //   - "specific" → the user's pick from the version picker
  const { data: latestVersion } = useClientQueries(schema).dataSetVersion.useFindFirst(
    {
      where: selectedDataSetId
        ? { dataSetId: selectedDataSetId }
        : { dataSetId: -1 },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        parametersJson: true,
        rowsJson: true,
      },
    },
    { enabled: open && selectedDataSetId !== null }
  );

  const { data: specificVersionData } = useClientQueries(schema).dataSetVersion.useFindFirst(
    {
      where: { id: specificVersion?.id ?? -1 },
      select: {
        id: true,
        version: true,
        parametersJson: true,
        rowsJson: true,
      },
    },
    { enabled: open && pinMode === "specific" && specificVersion !== null }
  );

  const activeVersion = useMemo<VersionShape | null>(() => {
    if (pinMode === "specific") {
      return (specificVersionData as VersionShape | null | undefined) ?? null;
    }
    return (latestVersion as VersionShape | null | undefined) ?? null;
  }, [pinMode, specificVersionData, latestVersion]);

  const datasetColumns = useMemo(
    () => deriveVersionColumns(activeVersion),
    [activeVersion]
  );

  // We need the case's parameters to render the mapping select. The
  // dialog uses the auto-generated ZenStack hook so callers don't have
  // to thread the parameters through props.
  const { data: caseParametersRaw } = useClientQueries(schema).testCaseParameter.useFindMany(
    {
      where: { testCaseId: caseId, isDeleted: false },
      orderBy: { order: "asc" },
      select: { name: true, required: true },
    },
    { enabled: open }
  );
  const caseParameters = useMemo(
    () =>
      (
        (caseParametersRaw ?? []) as Array<{
          name: string;
          required: boolean;
        }>
      ).map((p) => ({ name: p.name, required: Boolean(p.required) })),
    [caseParametersRaw]
  );

  // ---------- Save ----------
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const handleSave = async () => {
    if (!selectedDataSetId) {
      setErrorBanner(t("assignSharedSelectDatasetFirst"));
      return;
    }
    if (!mappingValid) {
      setErrorBanner(t("assignSharedFixMappingFirst"));
      return;
    }
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const pinnedVersionId =
        pinMode === "follow-latest"
          ? null
          : pinMode === "current"
            ? (latestVersion?.id ?? null)
            : (specificVersion?.id ?? null);
      // "current" with no version yet would be a no-op pin; the server
      // accepts a null pin and will record the assignment as
      // follow-latest. Surface this to the user only when the dataset
      // truly has no saved version (latestVersion missing entirely).
      if (pinMode === "current" && !latestVersion) {
        setErrorBanner(t("assignSharedNoVersionsYet"));
        setSubmitting(false);
        return;
      }
      // Filter the mapping down to columns that exist on the resolved
      // version. The server validates this too — defense in depth on the
      // client side keeps the payload small.
      const allowedColumns = new Set(datasetColumns);
      const filteredMapping: Record<string, string> = {};
      for (const [col, value] of Object.entries(mapping)) {
        if (allowedColumns.size === 0 || allowedColumns.has(col)) {
          filteredMapping[col] = value;
        }
      }
      const res = await fetch(
        `/api/repository/cases/${caseId}/shared-dataset`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sharedDataSetId: selectedDataSetId,
            pinnedVersionId,
            mappingJson: filteredMapping,
          }),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        if (res.status === 422 && json?.error === "cross_project") {
          setErrorBanner(t("assignSharedCrossProjectError"));
        } else if (res.status === 422 && json?.error === "required_unmapped") {
          setErrorBanner(t("assignSharedRequiredUnmappedError"));
        } else {
          setErrorBanner(t("assignSharedSaveError"));
        }
        return;
      }
      const datasetName =
        datasets.find((d) => d.id === selectedDataSetId)?.name ?? "";
      toast.success(t("assignSharedSuccess", { datasetName }));
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "CaseSharedDataSetAssignment"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSet"],
      });
      onSaved?.();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const latestVersionNumber = latestVersion?.version ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="assign-shared-dataset-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("assignSharedTitle")}</DialogTitle>
          <DialogDescription>{t("assignSharedDescription")}</DialogDescription>
        </DialogHeader>

        {hasOwnerDataset && (
          <Alert variant="default" data-testid="assign-shared-owner-banner">
            <AlertDescription>{t("assignSharedHasOwnerInfo")}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          {/* Section 1 — Choose dataset */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">
              {t("assignSharedSection1")}
            </h4>
            {datasetsLoading ? (
              <div className="text-sm text-muted-foreground">
                {tCommon("loading")}
              </div>
            ) : datasets.length === 0 ? (
              <div className="rounded-md border p-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("assignSharedNoDatasets")}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/projects/settings/${projectId}/datasets`}
                    onClick={() => onOpenChange(false)}
                  >
                    {t("assignSharedCreateDataset")}
                  </Link>
                </Button>
              </div>
            ) : (
              <Select
                value={
                  selectedDataSetId !== null ? String(selectedDataSetId) : ""
                }
                onValueChange={(v) => setSelectedDataSetId(Number(v))}
              >
                <SelectTrigger
                  className="w-full"
                  data-testid="assign-shared-dataset-select"
                >
                  <SelectValue
                    placeholder={t("assignSharedDatasetPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          {/* Section 2 — Pin version */}
          {selectedDataSetId !== null && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">
                {t("assignSharedSection2")}
              </h4>
              <RadioGroup
                value={pinMode}
                onValueChange={(v) => setPinMode(v as PinMode)}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="current"
                    id="assign-shared-pin-current"
                    data-testid="assign-shared-pin-current"
                  />
                  <label
                    htmlFor="assign-shared-pin-current"
                    className="text-sm cursor-pointer"
                  >
                    {latestVersionNumber !== null
                      ? t("assignSharedPinCurrent", {
                          version: String(latestVersionNumber),
                        })
                      : t("assignSharedPinCurrentNoVersion")}
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="follow-latest"
                    id="assign-shared-pin-follow-latest"
                    data-testid="assign-shared-pin-follow-latest"
                  />
                  <label
                    htmlFor="assign-shared-pin-follow-latest"
                    className="text-sm cursor-pointer"
                  >
                    {t("assignSharedPinFollowLatest")}
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value="specific"
                    id="assign-shared-pin-specific"
                    data-testid="assign-shared-pin-specific"
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-2">
                    <label
                      htmlFor="assign-shared-pin-specific"
                      className="text-sm cursor-pointer"
                    >
                      {t("assignSharedPinSpecific")}
                    </label>
                    {pinMode === "specific" && (
                      <div data-testid="assign-shared-pin-specific-picker">
                        <SharedDatasetVersionPicker
                          dataSetId={selectedDataSetId}
                          mode="picker"
                          value={
                            specificVersion === null
                              ? "current"
                              : specificVersion
                          }
                          onChange={(next) => {
                            if (next === "current") {
                              setSpecificVersion(null);
                            } else {
                              setSpecificVersion({
                                id: next.id,
                                version: next.version,
                              });
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </RadioGroup>
            </section>
          )}

          {/* Section 3 — Map columns */}
          {selectedDataSetId !== null && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">
                {t("assignSharedSection3")}
              </h4>
              <SharedDatasetMappingFields
                datasetColumns={datasetColumns}
                parameters={caseParameters}
                mapping={mapping}
                onMappingChange={setMapping}
                onValidityChange={setMappingValid}
              />
            </section>
          )}

          {errorBanner && (
            <Alert variant="destructive">
              <AlertDescription>{errorBanner}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="assign-shared-cancel"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleSave}
            disabled={
              submitting ||
              selectedDataSetId === null ||
              !mappingValid ||
              (pinMode === "specific" && specificVersion === null)
            }
            data-testid="assign-shared-save"
          >
            {t("assignSharedSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Re-export to keep the module's public surface explicit; consumers
// importing from this file may also need the sentinel.
export { SKIP_SENTINEL };

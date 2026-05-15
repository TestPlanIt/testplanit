"use client";

import { Loading } from "@/components/Loading";
import {
  DatasetTab,
  type DatasetTabRow,
} from "@/components/parameters/DatasetTab";
import { SharedDatasetVersionPicker } from "@/components/parameters/SharedDatasetVersionPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Save as SaveIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useFindFirstDataSet,
  useFindFirstDataSetVersion,
  useFindManyDataSetRow,
} from "~/lib/hooks";
import { Link } from "~/lib/navigation";

interface SharedDatasetEditorProps {
  projectId: number;
  dataSetId: number;
}

interface ParameterRecord {
  id: number;
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  sensitive: boolean;
  required: boolean;
  allowedValuesJson?: unknown;
  lookupAllowedValues?: string[];
}

type SelectedVersion = "current" | { id: number; version: number };

interface SerializableRow {
  id: number;
  label: string | null;
  rowIndex: number;
  valuesJson: Record<string, unknown> | null;
}

/**
 * Stable, order-independent serialization used to detect dirty state.
 * Comparing JSON.stringify of the row arrays would be order-sensitive
 * but mis-detect formatting-only object-key reorderings; this builds a
 * deterministic shape for the diff.
 */
function serializeRows(rows: SerializableRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      label: r.label ?? null,
      rowIndex: r.rowIndex,
      valuesJson: r.valuesJson ?? {},
    }))
  );
}

function serializeParameters(params: ParameterRecord[]): string {
  return JSON.stringify(
    params.map((p) => ({
      name: p.name,
      type: p.type,
      sensitive: p.sensitive,
      required: p.required,
    }))
  );
}

export function SharedDatasetEditor({
  projectId,
  dataSetId,
}: SharedDatasetEditorProps) {
  const t = useTranslations("projects.settings.datasets");
  const tEditor = useTranslations("projects.settings.datasets.editor");
  const queryClient = useQueryClient();

  const [selectedVersion, setSelectedVersion] =
    useState<SelectedVersion>("current");
  const [pendingRows, setPendingRows] = useState<DatasetTabRow[] | null>(null);
  const [pendingParameters, setPendingParameters] = useState<
    ParameterRecord[] | null
  >(null);
  const [baselineRowsKey, setBaselineRowsKey] = useState<string>("");
  const [baselineParamsKey, setBaselineParamsKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ----- Dataset metadata -----
  const {
    data: dataset,
    isLoading: datasetLoading,
    error: datasetError,
  } = useFindFirstDataSet({
    where: {
      id: dataSetId,
      projectId,
      isShared: true,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
    },
  });

  // ----- Live rows for "current" view -----
  // The Save endpoint mirrors the latest version into DataSetRow rows,
  // so reading from DataSetRow is the right source of truth for the
  // editable surface; for historical views we resolve rowsJson from the
  // pinned DataSetVersion below.
  const isCurrentView = selectedVersion === "current";
  const { data: liveRowsRaw, isLoading: liveRowsLoading } =
    useFindManyDataSetRow(
      {
        where: { dataSetId, isDeleted: false },
        orderBy: { rowIndex: "asc" },
        select: { id: true, label: true, rowIndex: true, valuesJson: true },
      },
      { enabled: isCurrentView }
    );

  // ----- Historical version when not in "current" view -----
  const historicalVersionId =
    selectedVersion !== "current" ? selectedVersion.id : -1;
  const { data: historicalVersion, isLoading: historicalLoading } =
    useFindFirstDataSetVersion(
      {
        where: { id: historicalVersionId },
        select: {
          id: true,
          version: true,
          parametersJson: true,
          rowsJson: true,
        },
      },
      { enabled: selectedVersion !== "current" }
    );

  // ----- Latest version (used to derive parameters when current view
  //       has no live row schema yet — e.g., first save not done). -----
  const { data: latestVersion } = useFindFirstDataSetVersion({
    where: { dataSetId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      parametersJson: true,
    },
  });

  // ----- Derive parameters for the editor surface -----
  const parameters: ParameterRecord[] = useMemo(() => {
    const source =
      selectedVersion === "current"
        ? (latestVersion?.parametersJson as unknown[] | null | undefined)
        : (historicalVersion?.parametersJson as unknown[] | null | undefined);
    if (!Array.isArray(source)) return [];
    return source.map((raw, idx): ParameterRecord => {
      const obj = raw as {
        name?: string;
        type?: ParameterRecord["type"];
        sensitive?: boolean;
        required?: boolean;
        allowedValues?: string[];
      };
      return {
        // Synthetic per-render id — DataSetVersion parameters are not
        // first-class entities with their own identifiers.
        id: idx + 1,
        name: obj.name ?? `column_${idx + 1}`,
        type: obj.type ?? "STRING",
        sensitive: Boolean(obj.sensitive),
        required: Boolean(obj.required),
        allowedValuesJson: obj.allowedValues ?? undefined,
      };
    });
  }, [selectedVersion, historicalVersion, latestVersion]);

  // ----- Build editor rows from the active source -----
  const sourceRows: DatasetTabRow[] = useMemo(() => {
    if (selectedVersion === "current") {
      const list = (liveRowsRaw ?? []) as Array<{
        id: number;
        label: string | null;
        rowIndex: number;
        valuesJson: Record<string, unknown> | null;
      }>;
      return list.map((r) => ({
        id: r.id,
        label: r.label,
        rowIndex: r.rowIndex,
        valuesJson: r.valuesJson,
      }));
    }
    if (!historicalVersion) return [];
    const rowsJson = (historicalVersion.rowsJson ?? []) as Array<{
      label?: string | null;
      valuesJson?: Record<string, unknown>;
    }>;
    return rowsJson.map((r, idx) => ({
      // Negative synthetic ids prevent collisions with live row ids
      // (which are positive autoincrements).
      id: -(idx + 1),
      label: r.label ?? null,
      rowIndex: idx,
      valuesJson: r.valuesJson ?? {},
    }));
  }, [selectedVersion, liveRowsRaw, historicalVersion]);

  // ----- Reset pending state whenever the source changes -----
  useEffect(() => {
    setPendingRows(sourceRows);
    setBaselineRowsKey(serializeRows(sourceRows));
    setSaveError(null);
  }, [sourceRows]);

  useEffect(() => {
    setPendingParameters(parameters);
    setBaselineParamsKey(serializeParameters(parameters));
  }, [parameters]);

  const editorRows = pendingRows ?? sourceRows;
  const editorParameters = pendingParameters ?? parameters;

  const isDirty = useMemo(() => {
    return (
      serializeRows(editorRows) !== baselineRowsKey ||
      serializeParameters(editorParameters) !== baselineParamsKey
    );
  }, [editorRows, baselineRowsKey, editorParameters, baselineParamsKey]);

  const handleRowsChange = useCallback((rows: DatasetTabRow[]) => {
    setPendingRows(rows);
  }, []);

  const handleParametersChange = useCallback((params: ParameterRecord[]) => {
    setPendingParameters(params);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Re-index rows so rowIndex matches the on-screen order — drag
      // reorders set rowIndex correctly, but adds may leave gaps.
      const renumbered = editorRows.map((r, idx) => ({
        label: r.label ?? null,
        valuesJson: r.valuesJson ?? {},
        _rowIndex: idx,
      }));

      // Build parametersJson from the editor's pending state so column
      // additions / renames / removals are persisted alongside the rows.
      // Falls back to the source version's shape when the user hasn't
      // touched parameters this session.
      const editorParametersJson = editorParameters.map((p, idx) => ({
        name: p.name,
        type: p.type,
        sensitive: p.sensitive,
        required: p.required,
        order: idx,
        ...(Array.isArray(p.allowedValuesJson)
          ? { allowedValues: p.allowedValuesJson }
          : {}),
      }));

      const branchedFromVersionId =
        selectedVersion === "current" ? undefined : selectedVersion.id;

      const res = await fetch(
        `/api/projects/${projectId}/datasets/${dataSetId}/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parametersJson: editorParametersJson,
            rowsJson: renumbered.map((r) => ({
              label: r.label,
              valuesJson: r.valuesJson,
            })),
            branchedFromVersionId,
          }),
        }
      );

      if (res.status === 422) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setSaveError(json.error ?? tEditor("validationError"));
        return;
      }
      if (!res.ok) {
        setSaveError(tEditor("saveError"));
        return;
      }

      const json = (await res.json()) as {
        ok: boolean;
        version: number;
      };

      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSet"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSetVersion"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSetRow"],
      });

      if (selectedVersion !== "current") {
        toast.success(
          t("saveSuccessBranched", {
            newVersion: json.version,
            fromVersion: selectedVersion.version,
          })
        );
      } else {
        toast.success(t("saveSuccess", { version: json.version }));
      }

      // Reset to current view after a successful save so the user sees
      // their freshly-committed state as the live working set.
      setSelectedVersion("current");
    } catch {
      setSaveError(tEditor("saveError"));
    } finally {
      setSaving(false);
    }
  }, [
    editorRows,
    editorParameters,
    projectId,
    dataSetId,
    selectedVersion,
    queryClient,
    t,
    tEditor,
  ]);

  if (datasetLoading) {
    return <Loading />;
  }

  if (datasetError || !dataset) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <h2 className="text-2xl font-semibold">{tEditor("notFound")}</h2>
          <p className="text-muted-foreground">
            {tEditor("notFoundDescription")}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/settings/${projectId}/datasets`}>
              <ArrowLeft className="h-4 w-4" />
              {tEditor("back")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isReadOnly = selectedVersion !== "current";
  const isLoadingRows =
    (isCurrentView && liveRowsLoading) || (!isCurrentView && historicalLoading);

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                asChild
                variant="ghost"
                size="sm"
                data-testid="shared-dataset-editor-back"
              >
                <Link href={`/projects/settings/${projectId}/datasets`}>
                  <ArrowLeft className="h-4 w-4" />
                  {tEditor("back")}
                </Link>
              </Button>
              <CardTitle className="truncate">{dataset.name}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <SharedDatasetVersionPicker
                dataSetId={dataSetId}
                value={selectedVersion}
                onChange={setSelectedVersion}
                mode="editor"
              />
              <Button
                onClick={handleSave}
                disabled={!isDirty || saving}
                data-testid="shared-dataset-editor-save"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SaveIcon className="h-4 w-4" />
                )}
                {tEditor("saveAction")}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            {isDirty
              ? tEditor("unsavedHint")
              : tEditor("savedHint", { version: dataset.version })}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedVersion !== "current" && (
            <Alert data-testid="shared-dataset-editor-historical-banner">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {isDirty
                  ? tEditor("branchingBanner", {
                      version: selectedVersion.version,
                    })
                  : tEditor("historicalReadOnlyBanner", {
                      version: selectedVersion.version,
                    })}
              </AlertDescription>
            </Alert>
          )}

          {saveError && (
            <Alert
              variant="destructive"
              data-testid="shared-dataset-editor-save-error"
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {isLoadingRows ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div
              className="border rounded-md overflow-hidden"
              data-testid="shared-dataset-editor-grid"
            >
              <DatasetTab
                // caseId is unused in shared mode but DatasetTab still
                // requires it as a positional prop — we pass the dataSetId
                // here so any debug logging surfaces a meaningful number.
                caseId={dataSetId}
                projectId={projectId}
                parameters={editorParameters}
                mode="shared-editor"
                rows={editorRows}
                onRowsChange={handleRowsChange}
                onParametersChange={handleParametersChange}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

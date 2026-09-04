"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import micromatch from "micromatch";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CodeViewer } from "@/components/code/CodeViewer";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  codePinErrorKey,
  createCodePin,
  updateCodePin,
  type CodePin,
  type CodePinKind,
  type CodePinUpdateInput,
} from "~/hooks/useCodePins";
import { useImpactFiles, type ImpactFileEntry } from "~/hooks/useImpactFiles";
import { symbolCandidates } from "~/lib/services/impact/pinMatcher";
import { codeLanguageFromPath } from "~/lib/utils/codeLanguageFromPath";
import { cn } from "~/utils";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";

export interface AddCodePinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  configId: number;
  repositoryId: number;
  caseId?: number;
  initialFilePath?: string;
  initialKind?: CodePinKind;
  onCreated?: (pin: CodePin, caseId: number) => void;
  /** Editing this pin instead of creating one. Its kind and file are fixed. */
  pin?: CodePin;
  onUpdated?: (pin: CodePin) => void;
}

interface CaseOption {
  id: number;
  name: string;
}

interface SymbolOption {
  name: string;
  /** Typed by hand rather than read out of the file. */
  typed?: boolean;
}

const KINDS: CodePinKind[] = ["FILE", "RANGE", "SYMBOL", "GLOB"];

const KIND_LABEL_KEY: Record<CodePinKind, string> = {
  FILE: "kindFile",
  RANGE: "kindRange",
  SYMBOL: "kindSymbol",
  GLOB: "kindGlob",
};

const DEFAULT_DATE_FORMAT = "MM-dd-yyyy";
const DEFAULT_TIME_FORMAT = "hh:mm a";

class FileLoadError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "FileLoadError";
  }
}

async function fetchRepositoryFile(
  repositoryId: number,
  configId: number,
  path: string
): Promise<{ content: string; sha: string | null }> {
  const params = new URLSearchParams({ configId: String(configId), path });
  const res = await fetch(
    `/api/code-repositories/${repositoryId}/file?${params.toString()}`
  );
  if (!res.ok) {
    let message = "Failed to load file.";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // Non-JSON body: keep the fallback message.
    }
    throw new FileLoadError(res.status, message);
  }
  const data = await res.json();
  return {
    content: typeof data?.content === "string" ? data.content : "",
    sha: typeof data?.sha === "string" ? data.sha : null,
  };
}

function parseLine(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function seedFile(path: string | undefined): ImpactFileEntry | null {
  return path ? { path, size: 0 } : null;
}

export function AddCodePinDialog({
  open,
  onOpenChange,
  projectId,
  configId,
  repositoryId,
  caseId,
  initialFilePath,
  initialKind = "FILE",
  onCreated,
  pin: editing,
  onUpdated,
}: AddCodePinDialogProps) {
  const t = useTranslations("repository.codePins");
  const locale = useLocale();
  const { data: session } = useSession();

  const [selectedCase, setSelectedCase] = useState<CaseOption | null>(null);
  const [kind, setKind] = useState<CodePinKind>(editing?.kind ?? initialKind);
  const [file, setFile] = useState<ImpactFileEntry | null>(() =>
    seedFile(
      editing && editing.kind !== "GLOB" ? editing.filePath : initialFilePath
    )
  );
  const [startLine, setStartLine] = useState<number | null>(null);
  const [endLine, setEndLine] = useState<number | null>(null);
  const [symbol, setSymbol] = useState("");
  const [glob, setGlob] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Tracked so the fixed height can step aside in full screen, where the
  // dialog sizes itself to the viewport.
  const [fullScreen, setFullScreen] = useState(false);

  const reset = useCallback(() => {
    setSelectedCase(null);
    setKind(editing?.kind ?? initialKind);
    setFile(
      seedFile(
        editing && editing.kind !== "GLOB" ? editing.filePath : initialFilePath
      )
    );
    setStartLine(editing?.startLine ?? null);
    setEndLine(editing?.endLine ?? null);
    setSymbol(editing?.symbol ?? "");
    setGlob(editing?.kind === "GLOB" ? editing.filePath : "");
    setNote(editing?.note ?? "");
    setSubmitting(false);
    setErrorMessage(null);
  }, [initialKind, initialFilePath, editing]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const effectiveCaseId = caseId ?? selectedCase?.id;

  const { files, meta, source, cacheEmpty, filter } = useImpactFiles(
    projectId,
    { repositoryId, configId, enabled: open }
  );

  const fetchFileOptions = useCallback(
    async (search: string, page: number, pageSize: number) =>
      filter(search, page, pageSize),
    [filter]
  );

  const fetchCases = useCallback(
    async (search: string, page: number, pageSize: number) => {
      const where = {
        projectId,
        isDeleted: false,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      };
      const params = {
        where,
        orderBy: { name: "asc" },
        skip: page * pageSize,
        take: pageSize,
        select: { id: true, name: true },
      };
      const res = await fetch(
        `/api/model/RepositoryCases/findMany?q=${encodeURIComponent(
          JSON.stringify(params)
        )}`
      );
      const data = await res.json();
      const results: CaseOption[] = Array.isArray(data.data) ? data.data : [];

      const countRes = await fetch(
        `/api/model/RepositoryCases/count?q=${encodeURIComponent(
          JSON.stringify({ where })
        )}`
      );
      const countData = await countRes.json();
      return { results, total: countData.data ?? 0 };
    },
    [projectId]
  );

  const filePath = file?.path ?? null;
  const needsFileContent = kind === "RANGE" || kind === "SYMBOL";
  const fileQuery = useQuery({
    queryKey: ["impactFile", repositoryId, configId, filePath],
    queryFn: () =>
      fetchRepositoryFile(repositoryId, configId, filePath as string),
    enabled: open && needsFileContent && filePath !== null,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Declarations the pin matcher can anchor to, so the picker never offers a
  // symbol that would be rejected on save.
  const symbolOptions = useMemo(() => {
    if (kind !== "SYMBOL" || !fileQuery.data) return [];
    return symbolCandidates(fileQuery.data.content.split(/\r?\n/)).map(
      (name) => ({ name })
    );
  }, [kind, fileQuery.data]);

  const fetchSymbolOptions = useCallback(
    async (search: string, page: number, pageSize: number) => {
      const query = search.trim();
      const matches = query
        ? symbolOptions.filter((option) =>
            option.name.toLowerCase().includes(query.toLowerCase())
          )
        : symbolOptions;
      // A name the file does not declare is still pinnable — generated code,
      // macros and bare class methods never make the list — so the search box
      // doubles as free-text entry.
      const results =
        query && !matches.some((option) => option.name === query)
          ? [{ name: query, typed: true }, ...matches]
          : matches;
      return {
        results: results.slice(page * pageSize, (page + 1) * pageSize),
        total: results.length,
      };
    },
    [symbolOptions]
  );

  const globPattern = glob.trim();
  const globMatchCount = useMemo(() => {
    if (kind !== "GLOB" || !globPattern || files.length === 0) return null;
    try {
      return micromatch(
        files.map((entry) => entry.path),
        globPattern
      ).length;
    } catch {
      return 0;
    }
  }, [kind, globPattern, files]);

  const preferences = session?.user?.preferences;
  const preferredDateFormat = preferences?.dateFormat;
  const preferredTimeFormat = preferences?.timeFormat;
  const preferredTimezone = preferences?.timezone;

  const fetchedAtLabel = useMemo(() => {
    if (!meta?.fetchedAt) return null;
    const date = new Date(meta.fetchedAt);
    if (Number.isNaN(date.getTime())) return meta.fetchedAt;
    // Date, time and zone as the viewer set them, so this reads the same as
    // the Last Fetched row on the Impact settings page.
    const dateLocale = getDateFnsLocale(locale);
    const formatString = `${mapDateTimeFormatString(
      preferredDateFormat ?? DEFAULT_DATE_FORMAT
    )} ${mapDateTimeFormatString(preferredTimeFormat ?? DEFAULT_TIME_FORMAT)}`;
    try {
      return preferredTimezone
        ? formatInTimeZone(date, preferredTimezone, formatString, {
            locale: dateLocale,
          })
        : format(date, formatString, { locale: dateLocale });
    } catch {
      try {
        return format(date, formatString, { locale: dateLocale });
      } catch {
        return meta.fetchedAt;
      }
    }
  }, [
    meta,
    preferredDateFormat,
    preferredTimeFormat,
    preferredTimezone,
    locale,
  ]);

  const filesStatus = cacheEmpty
    ? t("noFilesCached")
    : source === "live"
      ? t("filesLive")
      : meta && fetchedAtLabel
        ? t("filesCached", { count: meta.fileCount, date: fetchedAtLabel })
        : null;

  const selection: [number, number] | null =
    startLine !== null ? [startLine, endLine ?? startLine] : null;

  const handleSelectionChange = useCallback(
    (range: [number, number] | null) => {
      if (!range) {
        setStartLine(null);
        setEndLine(null);
        return;
      }
      setStartLine(range[0]);
      setEndLine(range[1]);
    },
    []
  );

  const rangeValid =
    startLine !== null && (endLine === null || endLine >= startLine);
  const isValid =
    effectiveCaseId !== undefined &&
    (kind === "FILE"
      ? file !== null
      : kind === "RANGE"
        ? file !== null && rangeValid
        : kind === "SYMBOL"
          ? file !== null && symbol.trim().length > 0
          : globPattern.length > 0);

  /** Only what the user actually changed, so an untouched pin is not re-anchored. */
  const buildPatch = (): CodePinUpdateInput => {
    if (!editing) return {};
    const patch: CodePinUpdateInput = {};
    if (kind === "GLOB" && globPattern !== editing.filePath) {
      patch.filePath = globPattern;
    }
    if (kind === "RANGE" && startLine !== null) {
      const end = endLine ?? startLine;
      if (startLine !== editing.startLine || end !== editing.endLine) {
        patch.startLine = startLine;
        patch.endLine = end;
      }
    }
    if (kind === "SYMBOL" && symbol.trim() !== editing.symbol) {
      patch.symbol = symbol.trim();
    }
    const nextNote = note.trim() ? note.trim() : null;
    if (nextNote !== (editing.note ?? null)) patch.note = nextNote;
    return patch;
  };

  const handleSave = async () => {
    if (!editing || !isValid) return;
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const updated = await updateCodePin(editing.caseId, editing.id, patch);
      onUpdated?.(updated);
      onOpenChange(false);
      reset();
    } catch (error) {
      const key = codePinErrorKey(error);
      setErrorMessage(key ? t(key) : t("updateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (editing) return handleSave();
    if (!isValid || effectiveCaseId === undefined) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const pin = await createCodePin(effectiveCaseId, {
        configId,
        kind,
        filePath:
          kind === "GLOB" ? globPattern : (file as ImpactFileEntry).path,
        ...(kind === "RANGE" && startLine !== null
          ? { startLine, endLine: endLine ?? startLine }
          : {}),
        ...(kind === "SYMBOL" ? { symbol: symbol.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onCreated?.(pin, effectiveCaseId);
      onOpenChange(false);
      reset();
    } catch (error) {
      const key = codePinErrorKey(error);
      setErrorMessage(key ? t(key) : t("addFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fileError =
    fileQuery.error instanceof FileLoadError ? fileQuery.error : null;
  const viewerStatus = fileQuery.isLoading
    ? t("viewerLoading")
    : fileQuery.error
      ? fileError?.status === 413
        ? t("viewerTooLarge")
        : fileError?.status === 404
          ? t("contentUnavailable")
          : t("viewerFailed")
      : null;

  // Say when the file yielded nothing, so an empty picker does not read as a
  // list that is still loading.
  const symbolStatus =
    kind === "SYMBOL" && file
      ? (viewerStatus ??
        (symbolOptions.length === 0
          ? t("symbolNoneDetected")
          : t("symbolHint")))
      : t("symbolHint");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        className={cn(
          "sm:max-w-2xl flex flex-col overflow-y-hidden",
          // One height for every pin kind: the dialog no longer grows and
          // shrinks as the kind changes, and the body scrolls instead.
          !fullScreen && "h-[90vh]"
        )}
        fullScreen={fullScreen}
        onFullScreenChange={setFullScreen}
        data-testid="code-pin-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {t(editing ? "editDialogTitle" : "addDialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {t(editing ? "editDialogDescription" : "addDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto px-1">
          {caseId === undefined && (
            <div className="space-y-1">
              <Label>{t("caseLabel")}</Label>
              <AsyncCombobox<CaseOption>
                value={selectedCase}
                onValueChange={setSelectedCase}
                fetchOptions={fetchCases}
                renderOption={(option) => (
                  <span className="truncate">{option.name}</span>
                )}
                getOptionValue={(option) => option.id}
                placeholder={t("casePlaceholder")}
                ariaLabel={t("caseLabel")}
                dropdownClassName="p-0 min-w-[400px] max-w-[800px]"
                pageSize={10}
                showTotal
                renderTrigger={({ value, defaultContent }) => (
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start text-start w-full"
                    data-testid="code-pin-case-combobox"
                  >
                    {value ? (
                      <span className="truncate">{value.name}</span>
                    ) : (
                      defaultContent
                    )}
                  </Button>
                )}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label>{t("kindLabel")}</Label>
            <ToggleGroup
              type="single"
              value={kind}
              onValueChange={(next) => {
                if (next) setKind(next as CodePinKind);
              }}
              variant="outline"
              size="sm"
              className="justify-start flex-wrap"
              aria-label={t("kindLabel")}
              disabled={editing !== undefined}
            >
              {KINDS.map((option) => (
                <ToggleGroupItem
                  key={option}
                  value={option}
                  data-testid={`code-pin-kind-${option}`}
                >
                  {t(KIND_LABEL_KEY[option])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {kind !== "GLOB" && (
            <div className="space-y-1">
              <Label>{t("fileLabel")}</Label>
              <AsyncCombobox<ImpactFileEntry>
                value={file}
                onValueChange={(option) => {
                  setFile(option);
                  setStartLine(null);
                  setEndLine(null);
                }}
                fetchOptions={fetchFileOptions}
                renderOption={(option) => (
                  <span className="font-mono text-xs truncate">
                    {option.path}
                  </span>
                )}
                getOptionValue={(option) => option.path}
                placeholder={t("filePlaceholder")}
                ariaLabel={t("fileLabel")}
                disabled={editing !== undefined}
                dropdownClassName="p-0 min-w-[400px] max-w-[800px]"
                pageSize={30}
                showTotal
                renderTrigger={({ value, defaultContent }) => (
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start text-start w-full"
                    disabled={editing !== undefined}
                    data-testid="code-pin-file-combobox"
                  >
                    {value ? (
                      <span className="font-mono text-xs truncate">
                        {value.path}
                      </span>
                    ) : (
                      defaultContent
                    )}
                  </Button>
                )}
              />
              {filesStatus && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="code-pin-files-status"
                >
                  {filesStatus}
                </p>
              )}
            </div>
          )}

          {kind === "RANGE" && file && (
            <div className="flex flex-1 min-h-0 flex-col gap-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="code-pin-start-line">{t("startLine")}</Label>
                  <Input
                    id="code-pin-start-line"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={startLine ?? ""}
                    onChange={(event) =>
                      setStartLine(parseLine(event.target.value))
                    }
                    data-testid="code-pin-start-line"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="code-pin-end-line">{t("endLine")}</Label>
                  <Input
                    id="code-pin-end-line"
                    type="number"
                    min={startLine ?? 1}
                    inputMode="numeric"
                    value={endLine ?? ""}
                    onChange={(event) =>
                      setEndLine(parseLine(event.target.value))
                    }
                    data-testid="code-pin-end-line"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("linesHint")}</p>
              {viewerStatus ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="code-pin-viewer-status"
                >
                  {viewerStatus}
                </p>
              ) : fileQuery.data ? (
                <div className="flex-1 min-h-40 overflow-hidden rounded-md border">
                  <CodeViewer
                    code={fileQuery.data.content}
                    language={codeLanguageFromPath(file.path)}
                    selection={selection}
                    onSelectionChange={handleSelectionChange}
                    className="h-full max-h-none"
                  />
                </div>
              ) : null}
            </div>
          )}

          {kind === "SYMBOL" && (
            <div className="space-y-1">
              <Label>{t("symbolLabel")}</Label>
              <AsyncCombobox<SymbolOption>
                value={symbol ? { name: symbol } : null}
                onValueChange={(option) => setSymbol(option?.name ?? "")}
                fetchOptions={fetchSymbolOptions}
                renderOption={(option) => (
                  <span className="font-mono text-xs truncate">
                    {option.typed
                      ? t("symbolUseTyped", { symbol: option.name })
                      : option.name}
                  </span>
                )}
                getOptionValue={(option) => option.name}
                // The trigger names the field; the placeholder sits in the
                // dropdown's search box, where "search" is what it does.
                triggerLabel={t("symbolSelectPlaceholder")}
                placeholder={t("symbolSearchPlaceholder")}
                ariaLabel={t("symbolLabel")}
                dropdownClassName="p-0 min-w-[400px] max-w-[800px]"
                pageSize={30}
                showTotal
                renderTrigger={({ value, defaultContent }) => (
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start text-start w-full"
                    data-testid="code-pin-symbol"
                  >
                    {value ? (
                      <span className="font-mono text-xs truncate">
                        {value.name}
                      </span>
                    ) : (
                      defaultContent
                    )}
                  </Button>
                )}
              />
              <p
                className="text-xs text-muted-foreground"
                data-testid="code-pin-symbol-status"
              >
                {symbolStatus}
              </p>
            </div>
          )}

          {kind === "GLOB" && (
            <div className="space-y-1">
              <Label htmlFor="code-pin-glob">{t("globLabel")}</Label>
              <Input
                id="code-pin-glob"
                value={glob}
                onChange={(event) => setGlob(event.target.value)}
                placeholder={t("globPlaceholder")}
                maxLength={4096}
                className="font-mono"
                data-testid="code-pin-glob"
              />
              {globMatchCount !== null && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="code-pin-glob-matches"
                >
                  {t("globMatches", { count: globMatchCount })}
                </p>
              )}
              {cacheEmpty && (
                <p className="text-xs text-muted-foreground">
                  {t("noFilesCached")}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="code-pin-note">{t("noteLabel")}</Label>
            <Textarea
              id="code-pin-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("notePlaceholder")}
              maxLength={2000}
              rows={2}
              data-testid="code-pin-note"
            />
          </div>

          {errorMessage && (
            <p
              className="text-sm text-destructive"
              data-testid="code-pin-error"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            data-testid="code-pin-submit"
          >
            {t(editing ? "saveChanges" : "submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddCodePinDialog;

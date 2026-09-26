"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Bookmark,
  BookmarkPlus,
  CircleCheck,
  LayoutTemplate,
  Loader2,
  Pencil,
  RefreshCw,
  Share2,
  Trash,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "~/utils";
import {
  buildSavedImportMappingConfig,
  isSameImportMapping,
  parseSavedImportMappingConfig,
  SAVED_IMPORT_MAPPING_DESCRIPTION_MAX_LENGTH,
  SAVED_IMPORT_MAPPING_NAME_MAX_LENGTH,
  scoreImportMappingMatch,
  type AppliedImportMapping,
  type ImportColumnMapping,
  type ImportMappingSettings,
  type ImportMappingWizard,
  type SavedImportMappingConfig,
} from "~/lib/schemas/savedImportMapping";

export interface LoadedImportMapping {
  id: string;
  name: string;
  templateId: number | null;
  config: SavedImportMappingConfig;
}

export interface CurrentImportMapping {
  columns: ImportColumnMapping[];
  settings?: ImportMappingSettings;
}

interface SavedImportMappingsProps {
  wizard: ImportMappingWizard;
  projectId: number;
  /** Test-case wizard only: the selected template, stored with a save. */
  templateId?: number | null;
  templateName?: string | null;
  /** The file's column names, used to suggest a matching saved mapping. */
  headers: string[];
  current: CurrentImportMapping;
  canSave?: boolean;
  onApply: (
    mapping: LoadedImportMapping
  ) => Promise<AppliedImportMapping | null> | AppliedImportMapping | null;
}

interface MappingRow {
  id: string;
  name: string;
  description: string | null;
  config: unknown;
  templateId: number | null;
  isShared: boolean;
  createdById: string;
  createdBy: { name: string } | null;
  template: { templateName: string } | null;
}

type EditTarget = Pick<MappingRow, "id" | "name" | "description"> & {
  shared: boolean;
  isOwner: boolean;
  templateName: string | null;
};

/**
 * The user's own mappings for a wizard plus those others shared. A shared
 * test-case mapping only counts here when its template is used by the project.
 */
function useSavedImportMappings(
  wizard: ImportMappingWizard,
  projectId: number,
  userId: string | undefined
) {
  const { data, isLoading } = useClientQueries(
    schema
  ).importMapping.useFindMany(
    {
      where: {
        wizard,
        isDeleted: false,
        OR: [
          { createdById: userId ?? "" },
          {
            isShared: true,
            ...(wizard === "TEST_CASES" && {
              OR: [
                { templateId: null },
                { template: { projects: { some: { projectId } } } },
              ],
            }),
          },
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        config: true,
        templateId: true,
        isShared: true,
        createdById: true,
        createdBy: { select: { name: true } },
        template: { select: { templateName: true } },
      },
      orderBy: { updatedAt: "desc" },
    },
    { enabled: !!userId }
  );
  const rows = useMemo(() => (data ?? []) as MappingRow[], [data]);
  return { rows, isLoading };
}

/**
 * Saved column mappings for a CSV import wizard's mapping page: a menu to
 * save, apply, edit, update and delete them, a suggestion when a saved
 * mapping covers the file's columns, and a notice listing saved columns that
 * could not be applied.
 */
export function SavedImportMappings({
  wizard,
  projectId,
  templateId = null,
  templateName = null,
  headers,
  current,
  canSave = true,
  onApply,
}: SavedImportMappingsProps) {
  const t = useTranslations("importMappings");
  const tCommon = useTranslations("common");
  const tSavedViews = useTranslations("repository.savedViews");
  const tLlmEdit = useTranslations("admin.llm.edit");
  const tParameters = useTranslations("parameters");
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const isAdmin = session?.user?.access === "ADMIN";

  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [updateTarget, setUpdateTarget] = useState<MappingRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MappingRow | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<AppliedImportMapping | null>(null);
  const [suggestionHidden, setSuggestionHidden] = useState(false);

  const headersKey = headers.join("\u0000");

  const { rows, isLoading } = useSavedImportMappings(wizard, projectId, userId);

  const { mutateAsync: updateMapping, isPending: isMutating } =
    useClientQueries(schema).importMapping.useUpdate();

  const onCurrentTemplateFirst = (a: MappingRow, b: MappingRow) =>
    Number(b.templateId === templateId) - Number(a.templateId === templateId);
  const mine = rows
    .filter((r) => r.createdById === userId)
    .sort(onCurrentTemplateFirst);
  const shared = rows
    .filter((r) => r.createdById !== userId)
    .sort(onCurrentTemplateFirst);

  const { suggestion, matchingIds } = useMemo(() => {
    let best: { row: MappingRow; score: number } | null = null;
    const matching = new Set<string>();
    for (const row of rows) {
      const config = parseSavedImportMappingConfig(row.config);
      if (!config) continue;
      const score =
        scoreImportMappingMatch(config.columns, headers) +
        (row.templateId !== null && row.templateId === templateId ? 0.001 : 0);
      if (score < 0.5) continue;
      matching.add(row.id);
      if (!best || score > best.score) best = { row, score };
    }
    return { suggestion: best?.row ?? null, matchingIds: matching };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, headersKey, templateId]);

  const canManage = (row: MappingRow) => row.createdById === userId || isAdmin;

  const handleApply = async (row: MappingRow) => {
    const config = parseSavedImportMappingConfig(row.config);
    if (!config) {
      toast.error(t("loadFailed"));
      return;
    }
    setOpen(false);
    setApplyingId(row.id);
    try {
      const result = await onApply({
        id: row.id,
        name: row.name,
        templateId: row.templateId,
        config,
      });
      setSuggestionHidden(true);
      if (!result) return;
      setSkipped(
        result.missingColumns.length > 0 || result.unavailableFields.length > 0
          ? result
          : null
      );
      toast.success(tSavedViews("applied", { name: row.name }));
    } finally {
      setApplyingId(null);
    }
  };

  const handleUpdate = async () => {
    if (!updateTarget) return;
    try {
      await updateMapping({
        where: { id: updateTarget.id },
        data: {
          config: buildSavedImportMappingConfig(current),
          templateId,
        },
      });
      toast.success(tCommon("messages.updateSuccess"));
      setUpdateTarget(null);
    } catch {
      toast.error(tCommon("messages.updateError"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await updateMapping({
        where: { id: deleteTarget.id },
        data: { isDeleted: true },
      });
      toast.success(tCommon("messages.deleteSuccess"));
      setDeleteTarget(null);
    } catch {
      toast.error(tCommon("messages.deleteError"));
    }
  };

  const renderRow = (row: MappingRow) => {
    const manageable = canManage(row);
    const sharer =
      row.createdById !== userId ? (row.createdBy?.name ?? "") : null;
    const sharedLabel =
      sharer !== null
        ? t("sharedBy", { name: sharer })
        : row.isShared
          ? tParameters("datasetSourceShared")
          : null;
    const templateName =
      wizard === "TEST_CASES" ? (row.template?.templateName ?? null) : null;

    return (
      <li key={row.id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void handleApply(row)}
          title={row.description ?? undefined}
          className="group/item flex min-w-0 flex-1 flex-col items-start rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
          data-testid="saved-import-mapping-item"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            {matchingIds.has(row.id) ? (
              <CircleCheck
                className="h-3.5 w-3.5 shrink-0 text-primary"
                aria-label={t("suggested")}
                role="img"
                data-testid="saved-import-mapping-match-icon"
              >
                <title>{t("suggested")}</title>
              </CircleCheck>
            ) : (
              matchingIds.size > 0 && (
                <span className="w-3.5 shrink-0" aria-hidden="true" />
              )
            )}
            <span className="truncate">{row.name}</span>
          </span>
          {(sharedLabel || templateName) && (
            <span
              className={cn(
                "flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground group-hover/item:text-accent-foreground",
                matchingIds.size > 0 && "ps-5"
              )}
            >
              {templateName && (
                <span
                  className="flex min-w-0 items-center gap-1"
                  title={tCommon("fields.template")}
                >
                  <LayoutTemplate className="h-3 w-3 shrink-0" />
                  <span className="truncate">{templateName}</span>
                </span>
              )}
              {sharedLabel && (
                <span
                  className="flex min-w-0 items-center gap-1"
                  title={sharedLabel}
                  aria-label={sharedLabel}
                  data-testid="saved-import-mapping-shared"
                >
                  <Share2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {sharer && <span className="truncate">{sharer}</span>}
                </span>
              )}
            </span>
          )}
        </button>
        {manageable && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={t("update")}
              title={t("update")}
              disabled={!canSave}
              onClick={() => {
                setUpdateTarget(row);
                setOpen(false);
              }}
              data-testid="saved-import-mapping-update"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={tCommon("actions.edit")}
              onClick={() => {
                setEditTarget({
                  id: row.id,
                  name: row.name,
                  description: row.description,
                  shared: row.isShared,
                  isOwner: row.createdById === userId,
                  templateName: row.template?.templateName ?? null,
                });
                setOpen(false);
              }}
              data-testid="saved-import-mapping-edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              aria-label={tCommon("actions.delete")}
              onClick={() => {
                setDeleteTarget(row);
                setOpen(false);
              }}
              data-testid="saved-import-mapping-delete"
            >
              <Trash className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </li>
    );
  };

  const suggestionConfig = suggestion
    ? parseSavedImportMappingConfig(suggestion.config)
    : null;
  const showSuggestion =
    suggestion !== null &&
    !suggestionHidden &&
    !(suggestionConfig && isSameImportMapping(suggestionConfig, current));

  return (
    <div className="space-y-3" data-testid="saved-import-mappings">
      <div className="flex justify-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={applyingId !== null}
              data-testid="saved-import-mappings-trigger"
            >
              {applyingId !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
              {t("title")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-1" align="end">
            <button
              type="button"
              disabled={!canSave}
              onClick={() => {
                setOpen(false);
                setSaveOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              data-testid="save-import-mapping-button"
            >
              <BookmarkPlus className="h-4 w-4 shrink-0" />
              {t("saveTitle")}
            </button>

            <Separator className="my-1" />

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tCommon("loading")}
              </div>
            ) : rows.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t("empty")}
              </p>
            ) : (
              <div
                className="max-h-80 overflow-y-auto"
                data-testid="saved-import-mappings-list"
              >
                {mine.length > 0 && (
                  <MappingGroup label={t("mine")}>
                    {mine.map(renderRow)}
                  </MappingGroup>
                )}
                {shared.length > 0 && (
                  <MappingGroup
                    label={t("shared")}
                    icon={<Share2 className="h-3 w-3" />}
                  >
                    {shared.map(renderRow)}
                  </MappingGroup>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {showSuggestion && (
        <Alert
          className="flex items-center gap-3"
          data-testid="saved-import-mapping-suggestion"
        >
          <AlertDescription className="flex min-w-0 flex-1 items-center gap-2">
            <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex min-w-0 items-center whitespace-nowrap">
              {t.rich("suggestionBanner", {
                name: suggestion.name,
                highlight: (chunks) => (
                  <span className="min-w-0 truncate">{chunks}</span>
                ),
              })}
            </span>
          </AlertDescription>
          <span className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              onClick={() => void handleApply(suggestion)}
              disabled={applyingId !== null}
              data-testid="saved-import-mapping-suggestion-apply"
            >
              {tCommon("actions.apply")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={tCommon("dismiss")}
              onClick={() => setSuggestionHidden(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </span>
        </Alert>
      )}

      {skipped && (
        <Alert data-testid="saved-import-mapping-skipped">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="flex items-center justify-between gap-2">
            {t("skippedTitle")}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={tCommon("dismiss")}
              onClick={() => setSkipped(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </AlertTitle>
          <AlertDescription className="space-y-1">
            {skipped.missingColumns.length > 0 && (
              <p>
                {t("missingColumns", {
                  columns: skipped.missingColumns.join(", "),
                })}
              </p>
            )}
            {skipped.unavailableFields.length > 0 && (
              <p>
                {t("unavailableFields", {
                  columns: skipped.unavailableFields
                    .map((m) => m.column)
                    .join(", "),
                })}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <SaveImportMappingDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        wizard={wizard}
        templateId={templateId}
        templateName={templateName}
        current={current}
      />

      <EditImportMappingDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
      />

      <AlertDialog
        open={updateTarget !== null}
        onOpenChange={(next) => !next && setUpdateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("update")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("updateConfirm", { name: updateTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleUpdate();
              }}
              disabled={isMutating}
              data-testid="saved-import-mapping-update-confirm"
            >
              {tLlmEdit("update")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tCommon("dialogs.delete.title", {
                item: deleteTarget?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tCommon("dialogs.delete.description", {
                name: deleteTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="saved-import-mapping-delete-confirm"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SaveImportMappingPromptProps {
  wizard: ImportMappingWizard;
  projectId: number;
  templateId?: number | null;
  templateName?: string | null;
  current: CurrentImportMapping;
  className?: string;
}

/**
 * Offers to save the mapping on a wizard's last step, unless a saved mapping
 * already has the same columns and settings.
 */
export function SaveImportMappingPrompt({
  wizard,
  projectId,
  templateId = null,
  templateName = null,
  current,
  className,
}: SaveImportMappingPromptProps) {
  const t = useTranslations("importMappings");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const { rows, isLoading } = useSavedImportMappings(
    wizard,
    projectId,
    session?.user?.id
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  const alreadySaved = rows.some((row) => {
    const config = parseSavedImportMappingConfig(row.config);
    return config !== null && isSameImportMapping(config, current);
  });

  if (hidden || isLoading || alreadySaved || current.columns.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
          className
        )}
        data-testid="save-import-mapping-prompt"
      >
        <span className="flex items-center gap-2 text-muted-foreground">
          <BookmarkPlus className="h-4 w-4 shrink-0" />
          {t("savePrompt")}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSaveOpen(true)}
            data-testid="save-import-mapping-prompt-button"
          >
            <BookmarkPlus className="h-4 w-4" />
            {t("saveTitle")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={tCommon("dismiss")}
            onClick={() => setHidden(true)}
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      </div>
      <SaveImportMappingDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        wizard={wizard}
        templateId={templateId}
        templateName={templateName}
        current={current}
        onSaved={() => setHidden(true)}
      />
    </>
  );
}

function MappingGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <p className="flex items-center gap-1 px-2 pb-1 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

interface SaveImportMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wizard: ImportMappingWizard;
  templateId?: number | null;
  templateName?: string | null;
  current: CurrentImportMapping;
  onSaved?: () => void;
}

/** Stores the current column mapping as a new named mapping. */
export function SaveImportMappingDialog({
  open,
  onOpenChange,
  wizard,
  templateId = null,
  templateName = null,
  current,
  onSaved,
}: SaveImportMappingDialogProps) {
  const t = useTranslations("importMappings");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const { mutateAsync: createMapping, isPending } =
    useClientQueries(schema).importMapping.useCreate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setShare(false);
      setError(null);
    }
  }, [open]);

  const handleSave = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(tCommon("fields.validation.nameRequired"));
      return;
    }
    if (!session?.user?.id) {
      setError(tCommon("errors.notAuthenticated.message"));
      return;
    }

    try {
      await createMapping({
        data: {
          name: trimmedName,
          description: description.trim() || null,
          wizard,
          config: buildSavedImportMappingConfig(current),
          templateId,
          isShared: share,
          createdById: session.user.id,
        },
      });
      toast.success(t("saved"));
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Error saving import mapping:", err);
      setError(tCommon("messages.createError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("saveTitle")}</DialogTitle>
          <DialogDescription>{t("saveDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="import-mapping-name">{tCommon("name")}</Label>
            <Input
              id="import-mapping-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={SAVED_IMPORT_MAPPING_NAME_MAX_LENGTH}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              data-testid="import-mapping-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-mapping-description">
              {tCommon("fields.description")}
            </Label>
            <Textarea
              id="import-mapping-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              maxLength={SAVED_IMPORT_MAPPING_DESCRIPTION_MAX_LENGTH}
              rows={2}
            />
          </div>
          <ShareCheckbox
            id="import-mapping-share"
            templateName={templateName}
            checked={share}
            onChange={setShare}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            data-testid="import-mapping-save-button"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {tCommon("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditImportMappingDialog({
  target,
  onClose,
}: {
  target: EditTarget | null;
  onClose: () => void;
}) {
  const t = useTranslations("importMappings");
  const tCommon = useTranslations("common");
  const { mutateAsync: updateMapping, isPending } =
    useClientQueries(schema).importMapping.useUpdate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [share, setShare] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setDescription(target.description ?? "");
      setShare(target.shared);
    }
  }, [target]);

  const handleSave = async () => {
    if (!target) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await updateMapping({
        where: { id: target.id },
        data: {
          name: trimmed,
          description: description.trim() || null,
          ...(target.isOwner && { isShared: share }),
        },
      });
      toast.success(tCommon("messages.updateSuccess"));
      onClose();
    } catch {
      toast.error(tCommon("messages.updateError"));
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="import-mapping-edit-name">{tCommon("name")}</Label>
            <Input
              id="import-mapping-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={SAVED_IMPORT_MAPPING_NAME_MAX_LENGTH}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              data-testid="import-mapping-edit-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-mapping-edit-description">
              {tCommon("fields.description")}
            </Label>
            <Textarea
              id="import-mapping-edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              maxLength={SAVED_IMPORT_MAPPING_DESCRIPTION_MAX_LENGTH}
              rows={2}
            />
          </div>
          {target?.isOwner && (
            <ShareCheckbox
              id="import-mapping-edit-share"
              templateName={target.templateName}
              checked={share}
              onChange={setShare}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            data-testid="import-mapping-edit-save-button"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {tCommon("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareCheckbox({
  id,
  templateName,
  checked,
  onChange,
}: {
  id: string;
  /** A shared mapping with a template is scoped to that template's projects. */
  templateName: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations("importMappings");
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        data-testid={`${id}-checkbox`}
      />
      <div className="grid gap-1">
        <Label htmlFor={id} className="cursor-pointer font-normal">
          {t("shareLabel")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {templateName
            ? t.rich("shareHintTemplate", {
                template: templateName,
                b: (chunks) => (
                  <span className="font-medium text-foreground">{chunks}</span>
                ),
              })
            : t("shareHint")}
        </p>
      </div>
    </div>
  );
}

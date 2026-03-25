"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { ExternalLink, FolderOpen, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  useFindManyCaseFields, useFindUniqueRepositoryCases, useFindUniqueSessions, useFindUniqueTestRuns
} from "~/lib/hooks";
import { extractTiptapText } from "~/lib/llm/services/auto-tag/content-extractor";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";

interface EntityDetailPopoverProps {
  entityId: number;
  entityType: EntityType;
  projectId: string;
  children: React.ReactNode;
  className?: string;
}

function getEntityHref(entityType: EntityType, projectId: string, entityId: number): string {
  switch (entityType) {
    case "repositoryCase":
      return `/projects/repository/${projectId}/${entityId}`;
    case "testRun":
      return `/projects/runs/${projectId}/${entityId}`;
    case "session":
      return `/projects/sessions/${projectId}/${entityId}`;
  }
}

/**
 * Safely extract plain text from a Tiptap JSON value.
 * ZenStack hooks may return Json fields as either parsed objects or strings.
 */
function extractRichText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        return extractTiptapText(JSON.parse(value));
      } catch {
        return value;
      }
    }
    return value;
  }
  return extractTiptapText(value);
}

/**
 * Resolve a field value to a human-readable string.
 * Dropdown/multi-select fields store option IDs — these are resolved using
 * the field's options lookup. Other types are returned as-is.
 */
function resolveFieldValue(
  value: unknown,
  optionsMap: Map<number, string>,
): string {
  if (value == null) return "";
  if (typeof value === "string") {
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        const parsed = JSON.parse(value);
        if (parsed?.type === "doc") return extractTiptapText(parsed);
      } catch {
        // Not JSON, return as plain text
      }
    }
    return value;
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    return optionsMap.get(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === "number" ? (optionsMap.get(v) ?? String(v)) : String(v),
      )
      .join(", ");
  }
  if (typeof value === "object") {
    if ((value as any)?.type === "doc") return extractTiptapText(value);
    return JSON.stringify(value);
  }
  return String(value);
}

export function EntityDetailPopover({
  entityId,
  entityType,
  projectId,
  children,
  className,
}: EntityDetailPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "cursor-pointer truncate text-left hover:underline",
            className,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-105 max-h-100 overflow-y-auto p-0"
        onWheel={(e) => e.stopPropagation()}
        side="right"
        align="start"
        collisionPadding={16}
      >
        <EntityDetailContent
          entityId={entityId}
          entityType={entityType}
        />
        <EntityDetailFooter
          entityType={entityType}
          projectId={projectId}
          entityId={entityId}
        />
      </PopoverContent>
    </Popover>
  );
}

function EntityDetailFooter({
  entityType,
  projectId,
  entityId,
}: {
  entityType: EntityType;
  projectId: string;
  entityId: number;
}) {
  const tDetail = useTranslations("autoTag.entityDetail");
  return (
    <div className="border-t px-4 py-2">
      <Link
        href={getEntityHref(entityType, projectId, entityId)}
        target="_blank"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        {tDetail("openInNewTab")}
      </Link>
    </div>
  );
}

function EntityDetailContent({
  entityId,
  entityType,
}: {
  entityId: number;
  entityType: EntityType;
}) {
  switch (entityType) {
    case "repositoryCase":
      return <CaseDetail entityId={entityId} />;
    case "testRun":
      return <TestRunDetail entityId={entityId} />;
    case "session":
      return <SessionDetail entityId={entityId} />;
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center p-6">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Build a global option ID → name lookup from CaseFields with their options.
 * Fetched separately to avoid ZenStack's 63-char PostgreSQL alias limit.
 */
function useFieldOptionsMap(fieldIds: number[]) {
  const { data: fields } = useFindManyCaseFields(
    fieldIds.length > 0
      ? {
          where: { id: { in: fieldIds } },
          include: {
            fieldOptions: {
              include: { fieldOption: true },
            },
          },
        }
      : undefined,
    { enabled: fieldIds.length > 0 },
  );

  return useMemo(() => {
    const map = new Map<number, string>();
    if (!fields) return map;
    for (const field of fields) {
      for (const assignment of (field as any).fieldOptions ?? []) {
        if (assignment.fieldOption) {
          map.set(assignment.fieldOption.id, assignment.fieldOption.name);
        }
      }
    }
    return map;
  }, [fields]);
}

function CaseDetail({ entityId }: { entityId: number }) {
  const t = useTranslations("common");
  const tDetail = useTranslations("autoTag.entityDetail");
  const { data, isLoading } = useFindUniqueRepositoryCases(
    {
      where: { id: entityId },
      include: {
        steps: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
        },
        caseFieldValues: { include: { field: true } },
        folder: true,
      },
    },
    { enabled: true },
  );

  const fieldIds = useMemo(
    () =>
      (data?.caseFieldValues ?? [])
        .map((cfv: any) => cfv.fieldId as number)
        .filter((id: number, i: number, arr: number[]) => arr.indexOf(id) === i),
    [data?.caseFieldValues],
  );
  const optionsMap = useFieldOptionsMap(fieldIds);

  if (isLoading || !data) return <LoadingState />;

  const steps = (data.steps ?? [])
    .map((s: any) => ({
      step: extractRichText(s.step),
      expected: extractRichText(s.expectedResult),
    }))
    .filter((s: { step: string; expected: string }) => s.step || s.expected);

  const fieldValues = (data.caseFieldValues ?? [])
    .map((cfv: any) => ({
      name: cfv.field?.displayName ?? "Field",
      value: resolveFieldValue(cfv.value, optionsMap),
    }))
    .filter((f: { value: string }) => f.value);

  const folderName = (data.folder as any)?.name;

  return (
    <div className="space-y-3 p-4">
      {folderName && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="truncate">{folderName}</span>
        </div>
      )}

      {steps.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>{t("fields.steps")}</SectionLabel>
          <ol className="space-y-1.5 text-xs">
            {steps.map((s, i) => (
              <li key={i} className="rounded border px-2 py-1.5">
                <p>{s.step}</p>
                {s.expected && (
                  <p className="mt-0.5 text-muted-foreground">
                    {t("fields.expectedResult")}: {s.expected}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {fieldValues.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>{tDetail("customFields")}</SectionLabel>
          <dl className="space-y-1 text-xs">
            {fieldValues.map((f, i) => (
              <div key={i} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{f.name}</dt>
                <dd className="truncate">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {steps.length === 0 && fieldValues.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          {tDetail("noDetails")}
        </p>
      )}
    </div>
  );
}

function TestRunDetail({ entityId }: { entityId: number }) {
  const t = useTranslations("common");
  const tDetail = useTranslations("autoTag.entityDetail");
  const { data, isLoading } = useFindUniqueTestRuns(
    {
      where: { id: entityId },
    },
    { enabled: true },
  );

  if (isLoading || !data) return <LoadingState />;

  const note = extractRichText((data as any).note);
  const docs = extractRichText((data as any).docs);

  return (
    <div className="space-y-3 p-4">
      {note && (
        <div className="space-y-1.5">
          <SectionLabel>{t("fields.note")}</SectionLabel>
          <p className="whitespace-pre-wrap text-xs">{note}</p>
        </div>
      )}

      {docs && (
        <div className="space-y-1.5">
          <SectionLabel>{t("fields.documentation")}</SectionLabel>
          <p className="whitespace-pre-wrap text-xs">{docs}</p>
        </div>
      )}

      {!note && !docs && (
        <p className="text-xs text-muted-foreground italic">
          {tDetail("noDetails")}
        </p>
      )}
    </div>
  );
}

function SessionDetail({ entityId }: { entityId: number }) {
  const t = useTranslations("common");
  const tDetail = useTranslations("autoTag.entityDetail");
  const { data, isLoading } = useFindUniqueSessions(
    {
      where: { id: entityId },
      include: {
        sessionFieldValues: { include: { field: true } },
      },
    },
    { enabled: true },
  );

  const sessionFieldValues = (data as any)?.sessionFieldValues;
  const fieldIds = useMemo(
    () =>
      (sessionFieldValues ?? [])
        .map((sfv: any) => sfv.fieldId as number)
        .filter((id: number, i: number, arr: number[]) => arr.indexOf(id) === i),
    [sessionFieldValues],
  );
  const optionsMap = useFieldOptionsMap(fieldIds);

  if (isLoading || !data) return <LoadingState />;

  const note = extractRichText((data as any).note);
  const mission = extractRichText((data as any).mission);

  const fieldValues: { name: string; value: string }[] = (
    (data as any).sessionFieldValues ?? []
  )
    .map((sfv: any) => ({
      name: sfv.field?.displayName ?? "Field",
      value: resolveFieldValue(sfv.value, optionsMap),
    }))
    .filter((f: { value: string }) => f.value);

  return (
    <div className="space-y-3 p-4">
      {note && (
        <div className="space-y-1.5">
          <SectionLabel>{t("fields.note")}</SectionLabel>
          <p className="whitespace-pre-wrap text-xs">{note}</p>
        </div>
      )}

      {mission && (
        <div className="space-y-1.5">
          <SectionLabel>{t("fields.mission")}</SectionLabel>
          <p className="whitespace-pre-wrap text-xs">{mission}</p>
        </div>
      )}

      {fieldValues.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>{tDetail("customFields")}</SectionLabel>
          <dl className="space-y-1 text-xs">
            {fieldValues.map((f, i) => (
              <div key={i} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{f.name}</dt>
                <dd className="truncate">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {!note && !mission && fieldValues.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          {tDetail("noDetails")}
        </p>
      )}
    </div>
  );
}

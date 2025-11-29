import { Prisma } from "@prisma/client";
import type {
  TestmoMappingConfiguration,
} from "../../services/imports/testmo/types";

export const toNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const toStringValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
};

export const toBooleanValue = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return fallback;
};

export const toDateValue = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.includes("T")
      ? trimmed.endsWith("Z")
        ? trimmed
        : `${trimmed}Z`
      : `${trimmed.replace(" ", "T")}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

export const buildNumberIdMap = (
  entries: Record<number, { mappedTo?: number | null | undefined } | undefined>
): Map<number, number> => {
  const map = new Map<number, number>();
  for (const [key, entry] of Object.entries(entries ?? {})) {
    if (!entry || entry.mappedTo === null || entry.mappedTo === undefined) {
      continue;
    }
    const sourceId = toNumberValue(key);
    const targetId = toNumberValue(entry.mappedTo);
    if (sourceId !== null && targetId !== null) {
      map.set(sourceId, targetId);
    }
  }
  return map;
};

export const buildStringIdMap = (
  entries: Record<number, { mappedTo?: string | null | undefined } | undefined>
): Map<number, string> => {
  const map = new Map<number, string>();
  for (const [key, entry] of Object.entries(entries ?? {})) {
    if (!entry || !entry.mappedTo) {
      continue;
    }
    const sourceId = toNumberValue(key);
    if (sourceId !== null) {
      map.set(sourceId, entry.mappedTo);
    }
  }
  return map;
};

export const buildTemplateFieldMaps = (
  templateFields: TestmoMappingConfiguration["templateFields"]
) => {
  const caseFields = new Map<string, number>();
  const resultFields = new Map<string, number>();

  for (const [key, entry] of Object.entries(templateFields ?? {})) {
    if (!entry || entry.mappedTo === null || entry.mappedTo === undefined) {
      continue;
    }
    const systemName = entry.systemName ?? entry.displayName ?? null;
    if (!systemName) {
      continue;
    }
    if (entry.targetType === "result") {
      resultFields.set(systemName, entry.mappedTo);
    } else {
      caseFields.set(systemName, entry.mappedTo);
    }
  }

  return { caseFields, resultFields };
};

export const resolveUserId = (
  userIdMap: Map<number, string>,
  fallbackUserId: string,
  value: unknown
): string => {
  const numeric = toNumberValue(value);
  if (numeric !== null) {
    const mapped = userIdMap.get(numeric);
    if (mapped) {
      return mapped;
    }
  }
  return fallbackUserId;
};

export const toInputJsonValue = (value: unknown): Prisma.InputJsonValue => {
  const { structuredClone } = globalThis as unknown as {
    structuredClone?: <T>(input: T) => T;
  };

  if (typeof structuredClone === "function") {
    return structuredClone(value) as Prisma.InputJsonValue;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

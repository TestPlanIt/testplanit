"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useCallback, useMemo } from "react";

import {
  RECORD_KEY_ENABLED_KEY,
  RECORD_KEY_TOKENS_KEY,
} from "~/lib/services/recordKeyConfig";
import {
  DEFAULT_TYPE_TOKENS,
  formatRecordKey,
  resolveTypeTokens,
  type RecordType,
  type TypeTokenMap,
} from "~/lib/recordKey";
import { schema } from "~/zenstack/schema";

/**
 * Client hook for project-prefixed record keys. Reads the two
 * AppConfig rows (master switch + token map) — both world-readable to
 * authenticated users — and returns a bound `formatKey` helper for display
 * surfaces (detail badges, list columns, client-side exports).
 *
 * `formatKey` returns `null` when the feature is disabled or the project has no
 * key, so callers fall back to showing the bare numeric id.
 */
export function useRecordKeyConfig(): {
  enabled: boolean;
  tokens: TypeTokenMap;
  isLoading: boolean;
  formatKey: (
    type: RecordType,
    projectKey: string | null | undefined,
    id: number
  ) => string | null;
} {
  const appConfig = useClientQueries(schema).appConfig;

  const { data: enabledRow, isLoading: enabledLoading } =
    appConfig.useFindUnique({ where: { key: RECORD_KEY_ENABLED_KEY } });
  const { data: tokensRow, isLoading: tokensLoading } = appConfig.useFindUnique(
    { where: { key: RECORD_KEY_TOKENS_KEY } }
  );

  const enabled = enabledRow?.value === true;
  const tokens = useMemo(
    () => resolveTypeTokens(tokensRow?.value),
    [tokensRow?.value]
  );

  const formatKey = useCallback(
    (type: RecordType, projectKey: string | null | undefined, id: number) => {
      if (!enabled) return null;
      return formatRecordKey({ projectKey, type, id, tokens });
    },
    [enabled, tokens]
  );

  return {
    enabled,
    tokens,
    isLoading: enabledLoading || tokensLoading,
    formatKey,
  };
}

/**
 * Resolve a single record's display key (e.g. `WEB-TR-1234`), or `null` when the
 * feature is disabled or the project has no code. Pass `projectKey` when the
 * caller already has it (no lookup); otherwise pass `projectId` and it is
 * fetched. Shared by {@link RecordKeyBadge} and the "Copy key" menu item.
 */
export function useRecordKey(args: {
  type: RecordType;
  id: number;
  projectKey?: string | null;
  projectId?: number;
}): string | null {
  const { enabled, formatKey } = useRecordKeyConfig();

  const needsLookup =
    enabled && args.projectKey === undefined && args.projectId !== undefined;
  const { data: project } = useClientQueries(schema).projects.useFindUnique(
    { where: { id: args.projectId ?? -1 }, select: { key: true } },
    { enabled: needsLookup }
  );

  const resolvedProjectKey = args.projectKey ?? project?.key ?? null;
  return formatKey(args.type, resolvedProjectKey, args.id);
}

export { DEFAULT_TYPE_TOKENS };

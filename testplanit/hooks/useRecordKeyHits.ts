"use client";

import { useQuery } from "@tanstack/react-query";

import { useRecordKeyConfig } from "~/hooks/useRecordKeyConfig";
import { parseRecordKey, recordTypeForToken } from "~/lib/recordKey";
import type { SearchHit } from "~/types/search";

/**
 * Resolve a search query that looks like a record identifier — either a bare
 * numeric id (`1234`) or a cosmetic key (`WEB-TC-1234`) — into search hits, so
 * the global search box can show them as normal result cards. Returns an empty
 * array when the feature is off or the query isn't id-shaped.
 */
export function useRecordKeyHits(query: string): SearchHit[] {
  const { enabled, tokens } = useRecordKeyConfig();
  const trimmed = query.trim();

  const isBareId = enabled && /^\d+$/.test(trimmed);
  const parsed = enabled
    ? parseRecordKey(trimmed, Object.values(tokens))
    : null;
  const hasKnownToken = !!(parsed && recordTypeForToken(parsed.token, tokens));
  const shouldResolve = Boolean(isBareId || hasKnownToken);

  const { data } = useQuery({
    queryKey: ["record-key-hits", trimmed],
    enabled: shouldResolve,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/record-key/resolve?key=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) return [] as SearchHit[];
      const body = (await res.json()) as { hits?: SearchHit[] };
      return body.hits ?? [];
    },
  });

  return shouldResolve ? (data ?? []) : [];
}

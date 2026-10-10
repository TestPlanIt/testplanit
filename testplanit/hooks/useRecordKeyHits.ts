"use client";

import { useQuery } from "@tanstack/react-query";

import { useRecordKeyConfig } from "~/hooks/useRecordKeyConfig";
import {
  parseRecordKey,
  recordTypeForToken,
  splitRecordQueryTerms,
} from "~/lib/recordKey";
import type { SearchHit } from "~/types/search";

/**
 * Resolve a search query that names records — bare numeric ids (`1234`,
 * `#1234`) or cosmetic keys (`WEB-TC-1234`), one or several joined by OR,
 * commas or spaces — into search hits, so the global search box can show them
 * as normal result cards. Returns an empty array when the feature is off or
 * any term isn't id-shaped.
 */
export function useRecordKeyHits(query: string): SearchHit[] {
  const { enabled, tokens } = useRecordKeyConfig();

  const terms = splitRecordQueryTerms(query).map((term) =>
    term.replace(/^#(?=\d+$)/, "")
  );
  const knownTokens = Object.values(tokens);
  const isResolvable = (term: string) => {
    if (/^\d+$/.test(term)) return true;
    const parsed = parseRecordKey(term, knownTokens);
    return !!(parsed && recordTypeForToken(parsed.token, tokens));
  };
  const shouldResolve =
    enabled && terms.length > 0 && terms.every(isResolvable);
  const cacheKey = terms.join(" ");

  const { data } = useQuery({
    queryKey: ["record-key-hits", cacheKey],
    enabled: shouldResolve,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const perTerm = await Promise.all(
        terms.map(async (term) => {
          const res = await fetch(
            `/api/record-key/resolve?key=${encodeURIComponent(term)}`
          );
          if (!res.ok) return [] as SearchHit[];
          const body = (await res.json()) as { hits?: SearchHit[] };
          return body.hits ?? [];
        })
      );
      const seen = new Set<string>();
      return perTerm.flat().filter((hit) => {
        const key = `${hit.entityType}-${hit.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });

  return shouldResolve ? (data ?? []) : [];
}

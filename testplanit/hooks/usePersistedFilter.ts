"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * List-filter state remembered per key in localStorage.
 *
 * Filters on pages people return to constantly are a personal working
 * preference, not something to re-pick every visit — but localStorage is not
 * available during SSR, so reading it in the state initializer would
 * hydrate-mismatch. The stored value is therefore read in an effect and the
 * hook reports whether that read has happened yet: callers that fire a
 * server-side query from the filter should wait for `hydrated`, so the query
 * runs once with the stored filter rather than once unfiltered and again a
 * tick later.
 *
 * `parse` is responsible for coercing anything the key might hold — absent,
 * unparseable, or a stale shape from an older build — into a usable value.
 *
 * @returns `[value, setValue, hydrated]`
 */
export function usePersistedFilter<T>(
  storageKey: string,
  fallback: T,
  parse: (stored: string | null) => T
): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(false);
    try {
      setValue(parse(window.localStorage.getItem(storageKey)));
    } catch {
      // localStorage unavailable (private mode) — keep the fallback.
      setValue(fallback);
    } finally {
      setHydrated(true);
    }
    // `parse` and `fallback` are expected to be module-level constants; keying
    // the effect on them too would re-read (and clobber) on every render for
    // callers that pass an inline literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Persistence is best-effort.
      }
    },
    [storageKey]
  );

  return [value, persist, hydrated];
}

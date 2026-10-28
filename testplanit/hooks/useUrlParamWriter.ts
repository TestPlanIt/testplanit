"use client";

import { useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { usePathname, useRouter } from "~/lib/navigation";
import {
  composeUrlSearch,
  releaseUrlWriteOverlay,
} from "~/utils/urlParamWrite";

/**
 * The single way to write search params on a page that has more than one
 * writer. Every caller composes through the shared overlay in
 * `~/utils/urlParamWrite`, so two writes landing in the same tick keep both
 * params instead of the second dropping the first's.
 *
 * `transform` runs on the composed query string on the way out — the
 * repository page uses it to keep readable `f` tokens from being re-encoded by
 * an unrelated write. **It must be a stable reference** (a module function or
 * something memoized); an inline arrow changes the returned writer every
 * render and will restart any effect that depends on it.
 *
 * Writes replace by default. Pass `{ history: "push" }` for a user-initiated
 * navigation that should get its own history entry — opening the case panel
 * does, so Back closes it. Either way `scroll` is suppressed: these are
 * same-page param updates, and jumping a long table to the top on one is not
 * wanted.
 */
export type UrlWriteOptions = { history?: "replace" | "push" };

export function useUrlParamWriter(
  transform?: (search: string) => string
): (
  mutate: (params: URLSearchParams) => void,
  options?: UrlWriteOptions
) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `useSearchParams` is not the source for composing — it lags further behind
  // than `window.location` does, and raw `history.replaceState` writes (TreeView's
  // `node`) never move it at all. It is only a signal that a navigation
  // committed, which is when the overlay should be reconsidered.
  useEffect(() => {
    releaseUrlWriteOverlay(pathname, window.location.search);
  }, [pathname, searchParams]);

  return useCallback(
    (mutate: (params: URLSearchParams) => void, options?: UrlWriteOptions) => {
      const next = composeUrlSearch(pathname, window.location.search, mutate);
      if (next === null) return;
      const qs = transform ? transform(next) : next;
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (options?.history === "push") {
        router.push(href, { scroll: false });
      } else {
        router.replace(href, { scroll: false });
      }
    },
    [pathname, router, transform]
  );
}

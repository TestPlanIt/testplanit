"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRepositoryCasesInvalidation } from "~/hooks/useRepositoryCasesQuery";
import { QuerySettingsProvider as ZenStackProvider } from "@zenstackhq/tanstack-query/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "~/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SearchStateProvider } from "~/lib/contexts/SearchStateContext";
import { operationIdFetcher } from "~/lib/zenstackFetcher";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: true,
      staleTime: 10000,
      gcTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

/**
 * Keeps the repository case-list queries in sync app-wide.
 *
 * The list is fetched over POST (outside ZenStack's model-keyed cache), so its
 * invalidation is rebuilt by subscription rather than granted for free. That
 * subscription has to live above the page: a case edited from its detail page —
 * moved to another folder, say — mutates while the list is unmounted, and a
 * seam mounted next to the list would never see it. Invalidating an inactive
 * query still marks it stale, so the list refetches when it is next shown.
 */
function RepositoryCasesCacheSync() {
  useRepositoryCasesInvalidation();
  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  const content = (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={[
        "light",
        "dark",
        "green",
        "orange",
        "purple",
        "accessible",
        "accessibledark",
      ]}
    >
      <SearchStateProvider>{children}</SearchStateProvider>
    </ThemeProvider>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Phase 14 CTX-03: install the ZenStack hooks Provider so EVERY generated
        mutation/query routes through operationIdFetcher, which stamps the
        X-Operation-Id header from the active operationId (useOperationId).
        endpoint is the generated-hook default (DEFAULT_QUERY_ENDPOINT =
        "/api/model"), so existing requests are unchanged — we only inject fetch.
      */}
      <ZenStackProvider
        value={{ endpoint: "/api/model", fetch: operationIdFetcher }}
      >
        <RepositoryCasesCacheSync />
        <SessionProvider>
          <TooltipProvider delayDuration={300}>{content}</TooltipProvider>
        </SessionProvider>
      </ZenStackProvider>
    </QueryClientProvider>
  );
}

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as ZenStackProvider } from "@zenstackhq/tanstack-query/runtime-v5/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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

export default function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const content = mounted ? (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark", "green", "orange", "purple"]}
    >
      <SearchStateProvider>{children}</SearchStateProvider>
    </ThemeProvider>
  ) : (
    <SearchStateProvider>{children}</SearchStateProvider>
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
        <SessionProvider>
          <TooltipProvider delayDuration={300}>{content}</TooltipProvider>
        </SessionProvider>
      </ZenStackProvider>
    </QueryClientProvider>
  );
}

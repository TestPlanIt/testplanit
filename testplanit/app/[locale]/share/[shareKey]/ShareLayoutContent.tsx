"use client";

import { ThemeProvider } from "~/components/theme-provider";
import { Session } from "next-auth";
import { useFindUniqueUserPreferences } from "~/lib/hooks";
import { useEffect, useState } from "react";

interface ShareLayoutContentProps {
  session: Session | null;
  children: React.ReactNode;
}

export function ShareLayoutContent({ session, children }: ShareLayoutContentProps) {
  const [mounted, setMounted] = useState(false);

  // Fetch user preferences if authenticated
  const { data: userPreferences } = useFindUniqueUserPreferences(
    session?.user?.id
      ? {
          where: { userId: session.user.id },
        }
      : undefined,
    {
      enabled: !!session?.user?.id,
    }
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Convert Theme enum to lowercase theme string
  const getUserTheme = () => {
    if (!userPreferences?.theme) return "system";

    // Theme enum values: Purple, Green, Orange, Light, Dark, System
    const themeMap: Record<string, string> = {
      Purple: "purple",
      Green: "green",
      Orange: "orange",
      Light: "light",
      Dark: "dark",
      System: "system",
    };

    return themeMap[userPreferences.theme] || "system";
  };

  // For authenticated users, use their preferred theme
  // For public/unauthenticated users, use system theme
  const defaultTheme = session ? getUserTheme() : "system";

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem
      themes={["light", "dark", "green", "orange", "purple"]}
      storageKey={session ? `theme-${session.user.id}` : "theme-public-share"}
      disableTransitionOnChange
    >
      <div className="min-h-screen bg-background" suppressHydrationWarning>
        {children}

        {/* Branding footer */}
        <footer className="fixed bottom-4 right-4 z-50">
          <a
            href="/"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Powered by</span>
            <span className="font-semibold">TestPlanIt</span>
          </a>
        </footer>
      </div>
    </ThemeProvider>
  );
}

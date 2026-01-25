"use client";

import { ThemeProvider } from "~/components/theme-provider";
import { Toaster } from "sonner";
import { Session } from "next-auth";
import { useFindUniqueUserPreferences } from "~/lib/hooks";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Link } from "~/lib/navigation";

interface ShareLayoutContentProps {
  session: Session | null;
  children: React.ReactNode;
}

export function ShareLayoutContent({ session, children }: ShareLayoutContentProps) {
  const [mounted, setMounted] = useState(false);
  const t = useTranslations("reports.shareDialog.footer");
  const tBranding = useTranslations("common.branding");

  // Fetch user preferences if authenticated
  const { data: userPreferences } = useFindUniqueUserPreferences(
    {
      where: { userId: session?.user?.id || "" },
    },
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
        <Toaster richColors toastOptions={{ className: "!z-[9999]" }} />

        {/* Branding footer */}
        <footer className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("poweredBy")}</span>
          <Link
            href="/"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="font-semibold flex items-center">
              <Image src="/tpi_logo.svg" alt={tBranding("logoAlt")} width={16} height={16} />
              {tBranding("name")}
            </span>
          </Link>
        </footer>
      </div>
    </ThemeProvider>
  );
}

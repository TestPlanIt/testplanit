import type { Metadata } from "next";
import { ThemeProvider } from "~/components/theme-provider";

export const metadata: Metadata = {
  title: "Shared Content | TestPlanIt",
  description: "View shared content from TestPlanIt",
};

/**
 * Minimal layout for public share pages
 * No header, no navigation - just the shared content
 */
export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark", "green", "orange", "purple"]}
    >
      <div className="min-h-screen bg-background">
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

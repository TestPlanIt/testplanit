import { signOut, useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTheme } from "next-themes";
import { Theme, Locale } from "@prisma/client";
import { useUpdateUser, useFindUniqueUser } from "~/lib/hooks";
import { languageNames } from "~/lib/navigation";
import { cn } from "~/utils";
import { useRef, useState } from "react";
import {
  Sun,
  Moon,
  SunMoon,
  User,
  Globe,
  Circle,
  LogOut,
  Check,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserDropdownMenu() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const { theme, setTheme } = useTheme();
  const { mutateAsync: updateUser } = useUpdateUser();
  const { refetch: refetchUser } = useFindUniqueUser(
    { where: { id: session?.user?.id || "" } },
    { enabled: !!session?.user?.id }
  );
  const t = useTranslations("userMenu");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function onSignout() {
    // Prevent multiple logout attempts and component re-renders
    if (isLoggingOut) {
      return;
    }
    
    setIsLoggingOut(true);
    
    try {
      // Call our comprehensive logout endpoint first
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Logout request failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        // Clear any local storage or session storage
        if (data.shouldClearLocalData) {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch (storageError) {
            console.warn('Failed to clear storage:', storageError);
          }
        }

        // Handle SSO logout URLs if provided
        if (data.ssoLogoutUrls && data.ssoLogoutUrls.length > 0) {
          // Check for SAML logout URLs that need redirection
          const samlLogoutUrl = data.ssoLogoutUrls.find((url: string) => 
            !url.includes('accounts.google.com')
          );
          
          if (samlLogoutUrl) {
            // For SAML, redirect immediately without calling NextAuth signOut
            // The SAML logout process will handle the full logout flow
            window.location.href = samlLogoutUrl;
            return;
          }
          
          // If only Google URLs (which we skip), continue with normal logout
        }

        // Call NextAuth signOut for local session cleanup
        try {
          await signOut({ redirect: false });
        } catch (signOutError) {
          console.warn('NextAuth signOut failed:', signOutError);
          // Continue with manual redirect even if signOut fails
        }
        
        // Use window.location for immediate navigation to prevent React hooks issues
        window.location.href = "/signin";
      } else {
        throw new Error(data.error || 'Logout failed');
      }
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback to NextAuth signOut on any error
      try {
        await signOut({ redirect: true, callbackUrl: "/signin" });
      } catch (fallbackError) {
        console.error('Fallback signOut also failed:', fallbackError);
        // Final fallback - manual navigation
        window.location.href = "/signin";
      }
    }
  }

  function onViewProfile() {
    router.push("/users/profile/" + session?.user?.id);
  }

  const handleThemeChange = async (newTheme: Theme) => {
    if (!session?.user) {
      return;
    }

    const themeLower = newTheme.toLowerCase();

    // Get the position of the dropdown button to originate the wipe from there
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    if (!buttonRect) {
      // Fallback to simple transition if we can't get button position
      setTheme(themeLower);
      return;
    }

    // Calculate center of button in pixels
    const x = buttonRect.left + buttonRect.width / 2;
    const y = buttonRect.top + buttonRect.height / 2;

    // Animation duration in milliseconds
    const ANIMATION_DURATION = 1200;

    // Create the wipe overlay
    const wipeOverlay = document.createElement("div");
    wipeOverlay.className = "theme-wipe-overlay";
    wipeOverlay.style.setProperty("--wipe-x", `${x}px`);
    wipeOverlay.style.setProperty("--wipe-y", `${y}px`);
    wipeOverlay.style.setProperty("--wipe-duration", `${ANIMATION_DURATION}ms`);

    // Set primary theme colors with transparency for cleaner animation
    const themeColors: Record<string, string> = {
      light: "rgba(34, 34, 56, 1)", // Dark blue-gray with low opacity for light theme
      dark: "rgba(100, 100, 120, 1)", // Gray-blue with higher opacity for visibility on dark
      system: window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "rgba(100, 100, 120, 1)"
        : "rgba(34, 34, 56, 1)",
      green: "rgba(34, 197, 94, 1)", // Green primary color
      orange: "rgba(251, 146, 60, 1)", // Orange primary color
      purple: "rgba(147, 51, 234, 1)", // Purple primary color
    };

    wipeOverlay.style.backgroundColor =
      themeColors[themeLower] || themeColors.light;
    document.body.appendChild(wipeOverlay);

    // Apply the theme immediately so it's revealed as the circle expands
    requestAnimationFrame(() => {
      setTheme(themeLower);
    });

    // Clean up after animation completes
    setTimeout(() => {
      wipeOverlay.remove();
    }, ANIMATION_DURATION);

    try {
      await updateUser({
        where: { id: session.user.id },
        data: {
          userPreferences: {
            upsert: {
              create: { theme: newTheme },
              update: { theme: newTheme },
            },
          },
        },
      });

      // Refresh the session to get updated preferences
      await update();
      await refetchUser();
    } catch (error) {
      console.error("Failed to update theme:", error);
      // Revert theme on error
      const currentTheme = session?.user?.preferences?.theme || "System";
      setTheme(currentTheme.toLowerCase());
    }
  };

  const handleLocaleChange = async (newLocale: Locale) => {
    if (!session?.user) {
      return;
    }

    try {
      await updateUser({
        where: { id: session.user.id },
        data: {
          userPreferences: {
            upsert: {
              create: { locale: newLocale },
              update: { locale: newLocale },
            },
          },
        },
      });

      const urlLocale = newLocale.replace("_", "-");
      document.cookie = `NEXT_LOCALE=${urlLocale};path=/;max-age=31536000`;
      window.location.reload();
    } catch (error) {
      console.error("Failed to update locale:", error);
    }
  };

  const renderThemeOption = (
    themeName: string,
    icon: React.ReactNode,
    color?: string
  ) => {
    const isActive = theme === themeName.toLowerCase();
    const updateTheme = async () => {
      if (themeName.toLowerCase() !== theme) {
        await handleThemeChange(themeName as Theme);
      }
    };

    return (
      <DropdownMenuItem onClick={updateTheme} className="flex items-center">
        {isActive && (
          <span className="mr-2">
            <Check className="w-4 h-4" />
          </span>
        )}
        {!isActive && (
          <span className="mr-2 opacity-0">
            <Check className="w-4 h-4" />
          </span>
        )}
        <span className={cn("mr-2", color)}>{icon}</span>
        <span className="grow">
          {t(`themes.${themeName.toLowerCase()}` as any)}
        </span>
      </DropdownMenuItem>
    );
  };

  if (!session || isLoggingOut) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={buttonRef}
          variant="link"
          className="hover:opacity-80"
          data-testid="user-menu-trigger"
          aria-label="User menu"
        >
          <Avatar
            image={session.user.image ?? ""}
            height={35}
            width={35}
            alt={session.user.name!}
            showTooltip={false}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60" data-testid="user-menu-content">
        <DropdownMenuLabel>
          <div>{session?.user?.name}</div>
          <div className="text-sm text-muted-foreground">
            {session?.user?.email}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onViewProfile}>
            <User className="h-4 w-4 mr-2" />
            {t("viewProfile")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="theme-submenu-trigger">
              <Sun className="h-4 w-4 mr-2" />
              {t("theme")}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent data-testid="theme-submenu-content">
                {renderThemeOption(
                  "Light",
                  <Sun className="h-4 w-4 fill-yellow-500" />,
                  "text-yellow-500"
                )}
                {renderThemeOption(
                  "Dark",
                  <Moon className="h-4 w-4 fill-slate-500" />,
                  "text-slate-500"
                )}
                {renderThemeOption(
                  "System",
                  <SunMoon className="h-4 w-4 fill-blue-500" />,
                  "text-blue-500"
                )}
                {renderThemeOption(
                  "Green",
                  <Circle className="h-4 w-4 fill-green-500" />,
                  "text-green-500"
                )}
                {renderThemeOption(
                  "Orange",
                  <Circle className="h-4 w-4 fill-orange-500" />,
                  "text-orange-500"
                )}
                {renderThemeOption(
                  "Purple",
                  <Circle className="h-4 w-4 fill-purple-500" />,
                  "text-purple-500"
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Globe className="h-4 w-4 mr-2" />
              {t("language")}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                {Object.entries(languageNames).map(([locale, label]) => {
                  const value = locale.replace("-", "_");
                  return (
                    <DropdownMenuItem
                      key={locale}
                      onClick={() => handleLocaleChange(value as Locale)}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 mr-2",
                          session?.user?.preferences?.locale === value
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem 
            onClick={onSignout}
            disabled={isLoggingOut}
          >
            <LogOut className="h-4 w-4 mr-2" />
            {t("signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

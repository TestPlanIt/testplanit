"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { DateFormatter } from "@/components/DateFormatter";
import { Circle, Moon, Sun, SunMoon } from "lucide-react";
import {
  DateFormat,
  ItemsPerPage,
  Locale,
  NotificationMode,
  Theme,
  TimeFormat,
} from "@prisma/client";
import {
  useFindFirstUserPreferences,
  useUpdateUserPreferences,
} from "~/lib/hooks";

type TimezoneOption = {
  id: string;
  name: string;
};

const FormSchema = z.object({
  theme: z.nativeEnum(Theme),
  locale: z.nativeEnum(Locale),
  itemsPerPage: z.nativeEnum(ItemsPerPage),
  dateFormat: z.nativeEnum(DateFormat),
  timeFormat: z.nativeEnum(TimeFormat),
  timezone: z.string().min(1),
  notificationMode: z.nativeEnum(NotificationMode),
});

export function InitialPreferencesDialog() {
  const { data: session, update } = useSession();
  const t = useTranslations("home.initialPreferences");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tNotificationsMode = useTranslations("users.profile.notifications.mode");
  const tNotificationDefaultMode = useTranslations("admin.notifications.defaultMode");
  const tUserMenu = useTranslations("userMenu");
  const tProfileEdit = useTranslations("users.profile.edit");
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { setTheme } = useTheme();
  const originalThemeRef = useRef<string | undefined>(undefined);

  const sessionUserId = session?.user?.id ?? "";

  const {
    data: userPreferences,
    refetch: refetchPreferences,
    isLoading: isPreferencesLoading,
  } = useFindFirstUserPreferences(
    {
      where: { userId: sessionUserId },
    },
    { enabled: !!sessionUserId }
  );

  const { mutateAsync: updateUserPreferences } = useUpdateUserPreferences();

  const defaultValues = useMemo(
    () => ({
      theme: userPreferences?.theme ?? Theme.Purple,
      locale: userPreferences?.locale ?? Locale.en_US,
      itemsPerPage: userPreferences?.itemsPerPage ?? ItemsPerPage.P10,
      dateFormat: userPreferences?.dateFormat ?? DateFormat.MM_DD_YYYY_DASH,
      timeFormat: userPreferences?.timeFormat ?? TimeFormat.HH_MM_A,
      timezone: userPreferences?.timezone ?? "Etc/UTC",
      notificationMode:
        userPreferences?.notificationMode ?? NotificationMode.USE_GLOBAL,
    }),
    [userPreferences]
  );

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  // Save the original theme when dialog opens, restore it when closed (unless saved)
  useEffect(() => {
    if (isOpen && originalThemeRef.current === undefined) {
      // Store the current theme preference from user preferences, not the active theme
      originalThemeRef.current = userPreferences?.theme?.toLowerCase() ?? "system";
    }
  }, [isOpen, userPreferences?.theme]);

  const shouldShowDialog = useMemo(() => {
    // Only show if we have a fully authenticated session with user data
    if (!session?.user?.id || isPreferencesLoading) {
      return false;
    }
    // Only show if user preferences exist
    if (!userPreferences?.id) {
      return false;
    }
    // Only show if the setup hasn't been completed
    return !userPreferences.hasCompletedInitialPreferencesSetup;
  }, [session?.user?.id, userPreferences, isPreferencesLoading]);

  useEffect(() => {
    if (shouldShowDialog) {
      setIsOpen(true);
    }
  }, [shouldShowDialog]);

  const timezoneOptions = useMemo<TimezoneOption[]>(() => {
    if (
      typeof Intl !== "undefined" &&
      typeof (Intl as any).supportedValuesOf === "function"
    ) {
      return (Intl.supportedValuesOf("timeZone") as string[]).map((tz) => ({
        id: tz,
        name: tz.replace(/_/g, " "),
      }));
    }
    return [
      { id: "Etc/UTC", name: "UTC" },
      { id: "America/New_York", name: "America/New York" },
      { id: "Europe/London", name: "Europe/London" },
    ];
  }, []);

  const fetchTimezoneOptions = async (
    query: string,
    page: number,
    pageSize: number
  ) => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = timezoneOptions.filter((option) =>
      option.name.toLowerCase().includes(normalizedQuery)
    );
    const start = page * pageSize;
    const paged = filtered.slice(start, start + pageSize);
    return {
      results: paged,
      total: filtered.length,
    };
  };

  const renderTimezoneOption = (option: TimezoneOption) => option.name;
  const getTimezoneOptionValue = (option: TimezoneOption) => option.id;

  const sampleDate = useMemo(() => new Date(), []);

  const getThemeLabel = (themeName: Theme) =>
    tUserMenu(`themes.${themeName.toLowerCase()}` as any);

  const getThemeIcon = (themeName: Theme) => {
    switch (themeName) {
      case "Light":
        return <Sun className="h-4 w-4 fill-yellow-500" />;
      case "Dark":
        return <Moon className="h-4 w-4 fill-slate-500" />;
      case "System":
        return <SunMoon className="h-4 w-4 fill-blue-500" />;
      case "Green":
        return <Circle className="h-4 w-4 fill-green-500" />;
      case "Orange":
        return <Circle className="h-4 w-4 fill-orange-500" />;
      case "Purple":
        return <Circle className="h-4 w-4 fill-purple-500" />;
      default:
        return <Circle className="h-4 w-4" />;
    }
  };

  const getThemeColor = (themeName: Theme) => {
    switch (themeName) {
      case "Light":
        return "text-yellow-500";
      case "Dark":
        return "text-slate-500";
      case "System":
        return "text-blue-500";
      case "Green":
        return "text-green-500";
      case "Orange":
        return "text-orange-500";
      case "Purple":
        return "text-purple-500";
      default:
        return "";
    }
  };

  const handleThemeChange = useCallback(
    (themeValue: Theme) => {
      const themeLower = themeValue.toLowerCase();

      // Apply theme immediately for preview
      setTheme(themeLower);

      // Manually set the theme class as a fallback to ensure immediate visual feedback
      // next-themes uses class attribute for theming
      if (typeof document !== "undefined") {
        requestAnimationFrame(() => {
          const html = document.documentElement;
          // Remove all theme classes
          html.classList.remove("light", "dark", "system", "green", "orange", "purple");
          // Add the new theme class
          html.classList.add(themeLower);
          // Update color scheme for browser native elements
          html.style.colorScheme = themeLower === "dark" ? "dark" : themeLower === "light" ? "light" : "";
        });
      }
    },
    [setTheme]
  );

  const getLocaleLabel = (locale: Locale) => {
    switch (locale) {
      case "en_US":
        return "English (US)";
      case "es_ES":
        return "Español (ES)";
      case "fr_FR":
        return "Français (FR)";
      default:
        return locale;
    }
  };

  const getNotificationModeLabel = (mode: NotificationMode) => {
    switch (mode) {
      case "USE_GLOBAL":
        return tNotificationsMode("useGlobal");
      case "NONE":
        return tCommon("access.none");
      case "IN_APP":
        return tNotificationDefaultMode("inApp");
      case "IN_APP_EMAIL_IMMEDIATE":
        return tNotificationDefaultMode("inAppEmailImmediate");
      case "IN_APP_EMAIL_DAILY":
        return tNotificationDefaultMode("inAppEmailDaily");
      default:
        return mode;
    }
  };

  const onSubmit = form.handleSubmit(async (data) => {
    if (!userPreferences?.id) {
      return;
    }

    setIsSubmitting(true);
    try {
      const updateData = {
        theme: data.theme,
        locale: data.locale,
        itemsPerPage: data.itemsPerPage,
        dateFormat: data.dateFormat,
        timeFormat: data.timeFormat,
        timezone: data.timezone,
        notificationMode: data.notificationMode,
        emailNotifications:
          data.notificationMode === "IN_APP_EMAIL_IMMEDIATE" ||
          data.notificationMode === "IN_APP_EMAIL_DAILY",
        inAppNotifications:
          data.notificationMode === "IN_APP" ||
          data.notificationMode === "IN_APP_EMAIL_IMMEDIATE" ||
          data.notificationMode === "IN_APP_EMAIL_DAILY",
        hasCompletedInitialPreferencesSetup: true,
      };

      await updateUserPreferences({
        where: { id: userPreferences.id },
        data: updateData,
      });

      await refetchPreferences();
      await update?.();

      // Mark theme as saved so we don't revert it
      originalThemeRef.current = undefined;

      toast.success(t("success"));
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to update initial preferences:", error);
      toast.error(t("error"));
    } finally {
      setIsSubmitting(false);
    }
  });

  const handleOpenChange = (open: boolean) => {
    // Don't allow manually closing the dialog since this is initial setup
    // User must either save or skip
    // However, we allow programmatic closing via save/skip buttons
    if (!open && isOpen) {
      return;
    }
    setIsOpen(open);
  };

  const handleSkip = async () => {
    if (!userPreferences?.id) {
      return;
    }

    // Restore original theme if user skips
    if (originalThemeRef.current !== undefined) {
      const originalTheme = originalThemeRef.current;
      setTheme(originalTheme);

      // Also manually restore the theme class
      if (typeof document !== "undefined") {
        const html = document.documentElement;
        html.classList.remove("light", "dark", "system", "green", "orange", "purple");
        html.classList.add(originalTheme);
        html.style.colorScheme = originalTheme === "dark" ? "dark" : originalTheme === "light" ? "light" : "";
      }
    }

    setIsSubmitting(true);
    try {
      await updateUserPreferences({
        where: { id: userPreferences.id },
        data: {
          hasCompletedInitialPreferencesSetup: true,
        },
      });
      await refetchPreferences();
      await update?.();
      originalThemeRef.current = undefined;
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to skip initial preferences:", error);
      toast.error(t("error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!shouldShowDialog) {
    return null;
  }

  const itemsPerPageOptions = Object.values(ItemsPerPage);
  const dateFormatOptions = Object.values(DateFormat);
  const timeFormatOptions = Object.values(TimeFormat);
  const themeOptions = Object.values(Theme);
  const localeOptions = Object.values(Locale);
  const notificationModeOptions = Object.values(NotificationMode);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="mt-4 space-y-6"
            data-testid="initial-preferences-form"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="theme"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("fields.theme")}</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={(value) => {
                          const themeValue = value as Theme;
                          handleThemeChange(themeValue);
                          field.onChange(themeValue);
                        }}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("fields.theme")} />
                        </SelectTrigger>
                        <SelectContent>
                          {themeOptions.map((option) => (
                            <SelectItem
                              key={option}
                              value={option}
                              textValue={getThemeLabel(option)}
                            >
                              <div className="flex items-center gap-2">
                                <span className={getThemeColor(option)}>
                                  {getThemeIcon(option)}
                                </span>
                                {getThemeLabel(option)}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="locale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("fields.locale")}</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("fields.locale")} />
                        </SelectTrigger>
                        <SelectContent>
                          {localeOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {getLocaleLabel(option)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="itemsPerPage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tGlobal("common.fields.itemsPerPage")}</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={tGlobal("common.fields.itemsPerPage")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {itemsPerPageOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option.replace("P", "")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notificationMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tNotificationsMode("label")}</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tNotificationsMode("label")} />
                        </SelectTrigger>
                        <SelectContent>
                          {notificationModeOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {getNotificationModeLabel(option)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dateFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dateFormat")}</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("dateFormat")} />
                        </SelectTrigger>
                        <SelectContent>
                          {dateFormatOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              <DateFormatter
                                date={sampleDate}
                                formatString={option}
                                timezone={form.watch("timezone")}
                              />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timeFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("timeFormat")}</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("timeFormat")} />
                        </SelectTrigger>
                        <SelectContent>
                          {timeFormatOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              <span className="font-mono">
                                <DateFormatter
                                  date={sampleDate}
                                  formatString={option}
                                  timezone={form.watch("timezone")}
                                />
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{tGlobal("common.fields.timezone")}</FormLabel>
                    <FormControl>
                      <AsyncCombobox<TimezoneOption>
                        value={
                          timezoneOptions.find(
                            (opt) => opt.id === field.value
                          ) ?? null
                        }
                        onValueChange={(option) => {
                          const newValue = option ? option.id : "Etc/UTC";
                          form.setValue("timezone", newValue);
                          field.onChange(newValue);
                        }}
                        fetchOptions={fetchTimezoneOptions}
                        renderOption={renderTimezoneOption}
                        getOptionValue={getTimezoneOptionValue}
                        placeholder={t("timezonePlaceholder")}
                        showTotal
                        showUnassigned={false}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="flex flex-wrap justify-end gap-2 sm:gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleSkip}
                disabled={isSubmitting}
              >
                {t("skip")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? tGlobal("common.actions.saving") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

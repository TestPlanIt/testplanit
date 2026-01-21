"use client";

import * as React from "react";
import { useEffect, useState, use, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  useFindFirstUser,
  useFindUniqueAppConfig,
} from "~/lib/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DateFormatter } from "@/components/DateFormatter";
import { Switch } from "@/components/ui/switch";
import { EditAvatarModal } from "./EditAvatar";
import { RemoveAvatar } from "./RemoveAvatar";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { TwoFactorSettings } from "./TwoFactorSettings";
import { ApiTokenSettings } from "./ApiTokenSettings";
import { Avatar } from "@/components/Avatar";
import { AccessLevelDisplay } from "@/components/tables/AccessLevelDisplay";
import { EmailCell } from "@/components/EmailDisplay";
import { UserProjectsDisplay } from "@/components/tables/UserProjectsDisplay";
import { GroupListDisplay } from "@/components/tables/GroupListDisplay";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import { UserMentionedComments } from "@/components/UserMentionedComments";
import { PenSquare, Check, X, Sun, Moon, SunMoon, Circle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import {
  ItemsPerPage,
  DateFormat,
  TimeFormat,
  NotificationMode,
  Theme,
  Locale,
} from "@prisma/client";

interface UserProfileProps {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface TimezoneOption {
  id: string;
  name: string;
}

const sampleDate = new Date("2024-05-19T16:20:00");

const UserProfile: React.FC<UserProfileProps> = ({ params, searchParams }) => {
  // Resolve the params and searchParams promises using React's `use`
  const { userId } = use(params);

  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: session } = useSession();
  const t = useTranslations("users.profile");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tEdit = useTranslations("users.profile.edit");
  const tNotifications = useTranslations("users.profile.notifications");
  const tNotificationModes = useTranslations("admin.notifications.defaultMode");
  const tUserMenu = useTranslations("userMenu");
  const { data: globalSettings } = useFindUniqueAppConfig({
    where: { key: "notificationSettings" },
  });

  const { data: user, refetch: refetchUser } = useFindFirstUser({
    where: {
      AND: [{ isDeleted: false }, { id: userId }],
    },
    include: {
      role: true,
      groups: true,
      projects: true,
      createdBy: true,
      createdUsers: true,
      userPreferences: true,
      // Use _count instead of loading all records for statistics
      _count: {
        select: {
          createdProjects: true,
          createdMilestones: true,
          repositoryCases: { where: { isDeleted: false } },
          createdSessions: true,
          testRunCreatedBy: true,
        },
      },
    },
  });

  // Form schema for editing
  const FormSchema = z.object({
    name: z.string().min(1, {
      message: tCommon("errors.nameRequired"),
    }),
    email: z.email().min(1, { message: tCommon("errors.emailRequired") }),
    theme: z.nativeEnum(Theme),
    locale: z.nativeEnum(Locale),
    itemsPerPage: z.nativeEnum(ItemsPerPage),
    dateFormat: z.nativeEnum(DateFormat),
    timeFormat: z.nativeEnum(TimeFormat),
    timezone: z.string().min(1, { message: tEdit("timezoneRequired") }),
    notificationMode: z.nativeEnum(NotificationMode),
  });

  const defaultFormValues = useMemo(
    () => ({
      name: user?.name || "",
      email: user?.email || "",
      theme: session?.user?.preferences?.theme ?? Theme.Purple,
      locale: session?.user?.preferences?.locale ?? Locale.en_US,
      itemsPerPage:
        session?.user?.preferences?.itemsPerPage ?? ItemsPerPage.P10,
      dateFormat:
        session?.user?.preferences?.dateFormat ?? DateFormat.MM_DD_YYYY_DASH,
      timeFormat: session?.user?.preferences?.timeFormat ?? TimeFormat.HH_MM_A,
      timezone: session?.user?.preferences?.timezone ?? "Etc/UTC",
      notificationMode:
        user?.userPreferences?.notificationMode ?? NotificationMode.USE_GLOBAL,
    }),
    [
      user?.name,
      user?.email,
      session?.user?.preferences,
      user?.userPreferences?.notificationMode,
    ]
  );

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: defaultFormValues,
  });

  const allTimezoneOptions = useMemo<TimezoneOption[]>(() => {
    let supportedTimezones: string[] = [];
    if (
      typeof Intl !== "undefined" &&
      typeof Intl.supportedValuesOf === "function"
    ) {
      supportedTimezones = Intl.supportedValuesOf("timeZone");
    }
    return supportedTimezones.map((tz) => ({
      id: tz,
      name: tz.replace(/_/g, " "),
    }));
  }, []);

  const fetchTimezoneOptions = async (
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ results: TimezoneOption[]; total: number }> => {
    const lowerQuery = query.toLowerCase();
    const filtered = allTimezoneOptions.filter((opt) =>
      opt.name.toLowerCase().includes(lowerQuery)
    );
    return {
      results: filtered.slice(page * pageSize, (page + 1) * pageSize),
      total: filtered.length,
    };
  };

  const renderTimezoneOption = (option: TimezoneOption) => option.name;
  const getTimezoneOptionValue = (option: TimezoneOption) => option.id;

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      // Build update data with only changed fields
      const updateData: any = {
        userPreferences: {
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
        },
      };

      // Only update name if it has changed
      if (data.name !== user?.name) {
        updateData.name = data.name;
      }

      // Only update email if not an SSO-only user AND if it has changed
      // Users with INTERNAL or BOTH can update their email
      if (user?.authMethod !== "SSO" && data.email !== user?.email) {
        updateData.email = data.email;
      }

      // Use dedicated update API endpoint instead of ZenStack
      // (ZenStack 2.21+ has issues with nested update operations)
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update user");
      }

      setIsEditing(false);
      window.location.reload();
    } catch (err: any) {
      // Handle errors from the new API endpoint
      if (err.message?.includes("Email already exists")) {
        form.setError("email", {
          type: "custom",
          message: tCommon("errors.emailExists"),
        });
      } else if (err.message?.includes("Forbidden") || err.message?.includes("Unauthorized")) {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      }
      setIsSubmitting(false);
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false);
    form.reset(defaultFormValues);
  };

  const getNotificationModeLabel = (mode: NotificationMode) => {
    switch (mode) {
      case "USE_GLOBAL":
        return tNotifications("mode.useGlobal");
      case "NONE":
        return tCommon("access.none");
      case "IN_APP":
        return tNotificationModes("inApp");
      case "IN_APP_EMAIL_IMMEDIATE":
        return tNotificationModes("inAppEmailImmediate");
      case "IN_APP_EMAIL_DAILY":
        return tNotificationModes("inAppEmailDaily");
      default:
        return mode;
    }
  };

  const getGlobalModeLabel = (mode: string | undefined) => {
    switch (mode) {
      case "NONE":
        return tCommon("access.none");
      case "IN_APP":
        return tNotificationModes("inApp");
      case "IN_APP_EMAIL_IMMEDIATE":
        return tNotificationModes("inAppEmailImmediate");
      case "IN_APP_EMAIL_DAILY":
        return tNotificationModes("inAppEmailDaily");
      default:
        return mode ?? "";
    }
  };

  const getLocaleLabel = (locale: Locale) => {
    switch (locale) {
      case "en_US":
        return "English (US)";
      case "es_ES":
        return "Español (ES)";
      default:
        return locale;
    }
  };

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

  const getThemeLabel = (themeName: Theme) => {
    return tUserMenu(`themes.${themeName.toLowerCase()}` as any);
  };

  useEffect(() => {
    if (isEditing && user) {
      form.reset(defaultFormValues);
    }
  }, [isEditing, defaultFormValues, form, user]);

  useEffect(() => {
    if (user) {
      if (typeof user !== "string") {
        setIsLoading(false);
      } else {
        router.replace("/404");
      }
    } else if (user === null) {
      router.push("/404");
    }
  }, [user, router, session]);

  if (isLoading || !session) {
    return null;
  }

  if (user && session)
    user.createdUsers = user.createdUsers.map((user) => ({
      ...user,
      userId: user.id,
    }));

  if (!user?.name && !user?.email && !user?.image) {
    return null;
  }

  if (session && session.user.access !== "NONE") {
    return (
      <div className="container mx-auto max-w-6xl space-y-6">
        <Card className="overflow-hidden">
          {/* Header Section with Avatar and Basic Info */}
          <CardHeader className="bg-linear-to-r from-muted/50 to-background">
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Avatar Section */}
              <div className="relative flex flex-col items-center space-y-4">
                <div className="relative">
                  <Avatar
                    alt={user.name}
                    image={user.image ?? ""}
                    objectFit="contain"
                    width={160}
                    height={160}
                  />
                  {user.image && user?.id === session?.user?.id && (
                    <div className="absolute -top-2 -right-2">
                      <RemoveAvatar user={user} />
                    </div>
                  )}
                </div>
                {user?.id === session?.user?.id && (
                  <EditAvatarModal user={user} />
                )}
              </div>

              {/* User Info and Actions */}
              <div className="flex-1 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    {!isEditing ? (
                      <>
                        <CardTitle className="text-2xl sm:text-3xl font-bold text-primary">
                          {user.name}
                        </CardTitle>
                        <CardDescription className="text-base">
                          <EmailCell email={user.email} fullWidth />
                        </CardDescription>
                      </>
                    ) : (
                      <Form {...form}>
                        <div className="space-y-4">
                          <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center">
                                  {tGlobal("common.name")}
                                  <HelpPopover helpKey="user.name" />
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    className="text-2xl font-bold"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center">
                                  {tGlobal("common.fields.email")}
                                  <HelpPopover helpKey="user.email" />
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="email"
                                    disabled={user?.authMethod === "SSO"}
                                    className={
                                      user?.authMethod === "SSO"
                                        ? "opacity-60"
                                        : ""
                                    }
                                  />
                                </FormControl>
                                {user?.authMethod === "SSO" && (
                                  <p className="text-sm text-muted-foreground">
                                    {tEdit("emailDisabledForSso")}
                                  </p>
                                )}
                                {user?.authMethod === "BOTH" && (
                                  <p className="text-sm text-muted-foreground">
                                    {tEdit("emailEditableForBoth")}
                                  </p>
                                )}
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </Form>
                    )}
                  </div>

                  {user?.id === session?.user?.id && (
                    <div className="flex gap-2">
                      {!isEditing ? (
                        <div className="flex flex-col gap-2 items-end">
                          <Button onClick={() => setIsEditing(true)}>
                            <PenSquare className="w-4 h-4" />
                            {tEdit("title")}
                          </Button>
                          {(user?.authMethod === "INTERNAL" ||
                            user?.authMethod === "BOTH") && (
                            <ChangePasswordModal />
                          )}
                          {user?.authMethod === "INTERNAL" && (
                            <Button
                              variant="outline"
                              onClick={() => router.push("/account/link-sso")}
                            >
                              {tEdit("linkSsoProvider")}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={handleCancelEdit}
                            disabled={isSubmitting}
                          >
                            <X className="w-4 h-4" />
                            {tCommon("cancel")}
                          </Button>
                          <Button
                            data-testid="profile-submit-button"
                            onClick={form.handleSubmit(onSubmit)}
                            disabled={isSubmitting}
                          >
                            <Check className="w-4 h-4" />
                            {isSubmitting
                              ? tCommon("actions.submitting")
                              : tCommon("actions.submit")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Projects Section */}
                <div className="pt-2">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide mb-2">
                    {tCommon("fields.projects")}
                  </h4>
                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <UserProjectsDisplay usePopover={false} userId={user.id} />
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>

          {/* Private Information Section - Only for own profile */}
          {(user?.id === session?.user?.id ||
            session.user.access === "ADMIN") && (
            <CardContent className="space-y-8 pt-6">
              <div>
                <Separator className="mb-6" />

                <Accordion
                  type="multiple"
                  defaultValue={[
                    "account",
                    "api-tokens",
                    "groups",
                    "activity",
                    "preferences",
                    "history",
                    "mentions",
                  ]}
                  className="w-full"
                >
                  {/* Account Information */}
                  <AccordionItem value="account">
                    <AccordionTrigger className="text-sm font-medium text-muted-foreground uppercase tracking-wide hover:no-underline">
                      {tCommon("fields.account")}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="bg-muted/30 p-4 rounded-lg border mt-2">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.systemAccess")}
                            </span>
                            <AccessLevelDisplay accessLevel={user.access} />
                          </div>

                          <Separator className="opacity-50" />

                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.authMethod")}
                            </span>
                            <Badge
                              variant={
                                user.authMethod === "SSO"
                                  ? "default"
                                  : user.authMethod === "BOTH"
                                    ? "outline"
                                    : "secondary"
                              }
                            >
                              {user.authMethod === "INTERNAL" &&
                                tCommon("auth.internal")}
                              {user.authMethod === "SSO" && tCommon("auth.sso")}
                              {user.authMethod === "BOTH" &&
                                tCommon("auth.both")}
                            </Badge>
                          </div>

                          <Separator className="opacity-50" />

                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.defaultRole")}
                            </span>
                            <Badge variant="secondary">{user.role.name}</Badge>
                          </div>

                          <Separator className="opacity-50" />

                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.apiUser")}
                            </span>
                            <Switch disabled checked={user.isApi} />
                          </div>

                          <Separator className="opacity-50" />

                          {/* Two-Factor Authentication Settings */}
                          <TwoFactorSettings
                            userId={user.id}
                            twoFactorEnabled={user.twoFactorEnabled || false}
                            isOwnProfile={user?.id === session?.user?.id}
                            onUpdate={() => refetchUser()}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* API Tokens - Only for own profile and if user has API access */}
                  {user?.id === session?.user?.id && user.isApi && (
                    <AccordionItem value="api-tokens">
                      <AccordionTrigger className="text-sm font-medium text-muted-foreground uppercase tracking-wide hover:no-underline">
                        {tGlobal("admin.menu.apiTokens")}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="bg-muted/30 p-4 rounded-lg border mt-2">
                          <ApiTokenSettings
                            userId={user.id}
                            isOwnProfile={user?.id === session?.user?.id}
                            isAdmin={session.user.access === "ADMIN"}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Groups and Relationships */}
                  <AccordionItem value="groups">
                    <AccordionTrigger className="text-sm font-medium text-muted-foreground uppercase tracking-wide hover:no-underline">
                      {tCommon("fields.groups")}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="bg-muted/30 p-4 rounded-lg border mt-2">
                        <GroupListDisplay groups={user.groups} />
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* User Activity Statistics */}
                  <AccordionItem value="activity">
                    <AccordionTrigger className="text-sm font-medium text-muted-foreground uppercase tracking-wide hover:no-underline">
                      {tCommon("fields.activity")}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="bg-muted/30 p-4 rounded-lg border mt-2">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.projects")}{" "}
                              {tCommon("fields.created")}
                            </span>
                            <Badge variant="outline">
                              {user._count?.createdProjects || 0}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.testCases")}{" "}
                              {tCommon("fields.created")}
                            </span>
                            <Badge variant="outline">
                              {user._count?.repositoryCases || 0}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.sessions")}{" "}
                              {tCommon("fields.created")}
                            </span>
                            <Badge variant="outline">
                              {user._count?.createdSessions || 0}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.testRuns")}{" "}
                              {tCommon("fields.created")}
                            </span>
                            <Badge variant="outline">
                              {user._count?.testRunCreatedBy || 0}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {tCommon("fields.milestones")}{" "}
                              {tCommon("fields.created")}
                            </span>
                            <Badge variant="outline">
                              {user._count?.createdMilestones || 0}
                            </Badge>
                          </div>

                          {user.lastActiveAt && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm">
                                {tCommon("fields.lastActive")}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                <DateFormatter
                                  date={user.lastActiveAt}
                                  formatString={
                                    session?.user.preferences?.dateFormat &&
                                    session?.user.preferences?.timeFormat
                                      ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat}`
                                      : session?.user.preferences?.dateFormat
                                  }
                                  timezone={session?.user.preferences?.timezone}
                                />
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* User Preferences - if viewing own profile */}
                  {user.userPreferences && (
                    <AccordionItem value="preferences">
                      <AccordionTrigger className="text-sm font-medium text-muted-foreground uppercase tracking-wide hover:no-underline">
                        {t("preferences.title")}
                      </AccordionTrigger>
                      <AccordionContent>
                        {!isEditing ? (
                          <div className="bg-muted/30 p-4 rounded-lg border mt-2">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm">
                                    {tCommon("fields.theme")}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={getThemeColor(
                                        user.userPreferences.theme
                                      )}
                                    >
                                      {getThemeIcon(user.userPreferences.theme)}
                                    </span>
                                    <Badge variant="secondary">
                                      {getThemeLabel(
                                        user.userPreferences.theme
                                      )}
                                    </Badge>
                                  </div>
                                </div>

                                <Separator className="opacity-50" />

                                <div className="flex items-center justify-between">
                                  <span className="text-sm">
                                    {tCommon("fields.locale")}
                                  </span>
                                  <Badge variant="secondary">
                                    {getLocaleLabel(
                                      user.userPreferences.locale
                                    )}
                                  </Badge>
                                </div>

                                <Separator className="opacity-50" />

                                <div className="flex items-center justify-between">
                                  <span className="text-sm">
                                    {tCommon("fields.itemsPerPage")}
                                  </span>
                                  <Badge variant="outline">
                                    {user.userPreferences.itemsPerPage.replace(
                                      "P",
                                      ""
                                    )}
                                  </Badge>
                                </div>
                              </div>

                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm">
                                    {tCommon("fields.timezone")}
                                  </span>
                                  <span className="text-sm text-muted-foreground">
                                    {user.userPreferences.timezone}
                                  </span>
                                </div>

                                <Separator className="opacity-50" />

                                <div className="flex items-center justify-between">
                                  <span className="text-sm">
                                    {tCommon("fields.notificationMode")}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <Badge variant="secondary">
                                      {getNotificationModeLabel(
                                        user.userPreferences.notificationMode
                                      )}
                                    </Badge>
                                    {user.userPreferences.notificationMode ===
                                      "USE_GLOBAL" &&
                                      globalSettings?.value && (
                                        <span className="text-xs text-primary/60 font-semibold">
                                          {`(${getGlobalModeLabel(
                                            (globalSettings.value as any)
                                              .defaultMode
                                          )})`}
                                        </span>
                                      )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <Form {...form}>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <FormField
                                control={form.control}
                                name="theme"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="flex items-center">
                                      {tCommon("fields.theme")}
                                      <HelpPopover helpKey="user.theme" />
                                    </FormLabel>
                                    <FormControl>
                                      <Select
                                        onValueChange={(value) => {
                                          form.setValue(
                                            "theme",
                                            value as Theme
                                          );
                                          field.onChange(value);
                                        }}
                                        value={field.value}
                                      >
                                        <SelectTrigger>
                                          <SelectValue
                                            placeholder={tCommon(
                                              "fields.theme"
                                            )}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.values(Theme).map((theme) => (
                                            <SelectItem
                                              key={theme}
                                              value={theme}
                                            >
                                              <div className="flex items-center gap-2">
                                                <span
                                                  className={getThemeColor(
                                                    theme
                                                  )}
                                                >
                                                  {getThemeIcon(theme)}
                                                </span>
                                                {getThemeLabel(theme)}
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
                                    <FormLabel className="flex items-center">
                                      {tCommon("fields.locale")}
                                      <HelpPopover helpKey="user.locale" />
                                    </FormLabel>
                                    <FormControl>
                                      <Select
                                        onValueChange={(value) => {
                                          form.setValue(
                                            "locale",
                                            value as Locale
                                          );
                                          field.onChange(value);
                                        }}
                                        value={field.value}
                                      >
                                        <SelectTrigger>
                                          <SelectValue
                                            placeholder={tCommon(
                                              "fields.locale"
                                            )}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.values(Locale).map(
                                            (locale) => (
                                              <SelectItem
                                                key={locale}
                                                value={locale}
                                              >
                                                {locale === "en_US"
                                                  ? "English (US)"
                                                  : locale === "es_ES"
                                                    ? "Español (ES)"
                                                    : locale}
                                              </SelectItem>
                                            )
                                          )}
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
                                    <FormLabel className="flex items-center">
                                      {tGlobal("common.fields.itemsPerPage")}
                                      <HelpPopover helpKey="user.itemsPerPage" />
                                    </FormLabel>
                                    <FormControl>
                                      <Select
                                        onValueChange={(value) => {
                                          form.setValue(
                                            "itemsPerPage",
                                            value as ItemsPerPage
                                          );
                                          field.onChange(value);
                                        }}
                                        value={field.value}
                                      >
                                        <SelectTrigger>
                                          <SelectValue
                                            placeholder={tGlobal(
                                              "common.fields.itemsPerPage"
                                            )}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.values(ItemsPerPage).map(
                                            (value) => (
                                              <SelectItem
                                                key={value}
                                                value={value}
                                              >
                                                {value.replace("P", "")}
                                              </SelectItem>
                                            )
                                          )}
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
                                    <FormLabel className="flex items-center">
                                      {tGlobal(
                                        "home.initialPreferences.dateFormat"
                                      )}
                                      <HelpPopover helpKey="user.dateFormat" />
                                    </FormLabel>
                                    <FormControl>
                                      <Select
                                        onValueChange={(value) => {
                                          form.setValue(
                                            "dateFormat",
                                            value as DateFormat
                                          );
                                          field.onChange(value);
                                        }}
                                        value={field.value}
                                      >
                                        <SelectTrigger>
                                          <SelectValue
                                            placeholder={tGlobal(
                                              "home.initialPreferences.dateFormat"
                                            )}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.values(DateFormat).map(
                                            (value) => (
                                              <SelectItem
                                                key={value}
                                                value={value}
                                              >
                                                <DateFormatter
                                                  date={sampleDate}
                                                  formatString={value}
                                                  timezone={
                                                    session?.user?.preferences
                                                      ?.timezone
                                                  }
                                                />
                                              </SelectItem>
                                            )
                                          )}
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
                                    <FormLabel className="flex items-center">
                                      {tGlobal(
                                        "home.initialPreferences.timeFormat"
                                      )}
                                      <HelpPopover helpKey="user.timeFormat" />
                                    </FormLabel>
                                    <FormControl>
                                      <Select
                                        onValueChange={(value) => {
                                          form.setValue(
                                            "timeFormat",
                                            value as TimeFormat
                                          );
                                          field.onChange(value);
                                        }}
                                        value={field.value}
                                      >
                                        <SelectTrigger>
                                          <SelectValue
                                            placeholder={tGlobal(
                                              "home.initialPreferences.timeFormat"
                                            )}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.values(TimeFormat).map(
                                            (format) => (
                                              <SelectItem
                                                key={format}
                                                value={format}
                                              >
                                                <DateFormatter
                                                  date={sampleDate}
                                                  formatString={format}
                                                  timezone={
                                                    session?.user?.preferences
                                                      ?.timezone
                                                  }
                                                />
                                              </SelectItem>
                                            )
                                          )}
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
                                  <FormItem>
                                    <FormLabel className="flex items-center">
                                      {tGlobal("common.fields.timezone")}
                                      <HelpPopover helpKey="user.timezone" />
                                    </FormLabel>
                                    <FormControl>
                                      <AsyncCombobox<TimezoneOption>
                                        value={
                                          allTimezoneOptions.find(
                                            (opt) => opt.id === field.value
                                          ) || null
                                        }
                                        onValueChange={(
                                          selectedOption: TimezoneOption | null
                                        ) => {
                                          const newValue = selectedOption
                                            ? selectedOption.id
                                            : "Etc/UTC";
                                          form.setValue("timezone", newValue);
                                          field.onChange(newValue);
                                        }}
                                        fetchOptions={fetchTimezoneOptions}
                                        renderOption={renderTimezoneOption}
                                        getOptionValue={getTimezoneOptionValue}
                                        placeholder={tEdit(
                                          "timezonePlaceholder"
                                        )}
                                        showTotal={true}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              {/* Notification Preferences - Full Width */}
                              <FormField
                                control={form.control}
                                name="notificationMode"
                                render={({ field }) => (
                                  <FormItem className="space-y-3 sm:col-span-2">
                                    <FormLabel className="flex items-center">
                                      {tNotifications("mode.label")}
                                      <HelpPopover helpKey="user.notificationMode" />
                                    </FormLabel>
                                    <FormControl>
                                      <RadioGroup
                                        onValueChange={field.onChange}
                                        value={field.value}
                                        className="grid grid-cols-1 md:grid-cols-2 gap-3"
                                      >
                                        <div className="flex items-center space-x-3">
                                          <RadioGroupItem
                                            value="USE_GLOBAL"
                                            id="use-global"
                                          />
                                          <Label
                                            htmlFor="use-global"
                                            className="font-normal"
                                          >
                                            {tNotifications("mode.useGlobal")}
                                            {globalSettings?.value && (
                                              <span className="text-sm text-primary/60 font-semibold ml-1">
                                                {`(${getGlobalModeLabel(
                                                  (globalSettings.value as any)
                                                    .defaultMode
                                                )})`}
                                              </span>
                                            )}
                                          </Label>
                                        </div>
                                        <div className="flex items-center space-x-3">
                                          <RadioGroupItem
                                            value="NONE"
                                            id="none"
                                          />
                                          <Label
                                            htmlFor="none"
                                            className="font-normal"
                                          >
                                            {tCommon("access.none")}
                                          </Label>
                                        </div>
                                        <div className="flex items-center space-x-3">
                                          <RadioGroupItem
                                            value="IN_APP"
                                            id="in-app"
                                          />
                                          <Label
                                            htmlFor="in-app"
                                            className="font-normal"
                                          >
                                            {tNotificationModes("inApp")}
                                          </Label>
                                        </div>
                                        <div className="flex items-center space-x-3">
                                          <RadioGroupItem
                                            value="IN_APP_EMAIL_IMMEDIATE"
                                            id="in-app-email-immediate"
                                          />
                                          <Label
                                            htmlFor="in-app-email-immediate"
                                            className="font-normal"
                                          >
                                            {tNotificationModes(
                                              "inAppEmailImmediate"
                                            )}
                                          </Label>
                                        </div>
                                        <div className="flex items-center space-x-3 md:col-start-1">
                                          <RadioGroupItem
                                            value="IN_APP_EMAIL_DAILY"
                                            id="in-app-email-daily"
                                          />
                                          <Label
                                            htmlFor="in-app-email-daily"
                                            className="font-normal"
                                          >
                                            {tNotificationModes(
                                              "inAppEmailDaily"
                                            )}
                                          </Label>
                                        </div>
                                      </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          </Form>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Account History */}
                  <AccordionItem value="history">
                    <AccordionTrigger className="text-sm font-medium text-muted-foreground uppercase tracking-wide hover:no-underline">
                      {tCommon("fields.accountHistory")}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="bg-muted/30 p-4 rounded-lg border mt-2">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm">
                                {tCommon("fields.dateCreated")}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                <DateFormatter
                                  date={user.createdAt}
                                  formatString={
                                    session?.user.preferences?.dateFormat &&
                                    session?.user.preferences?.timeFormat
                                      ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat}`
                                      : session?.user.preferences?.dateFormat
                                  }
                                  timezone={session?.user.preferences?.timezone}
                                />
                              </span>
                            </div>

                            <Separator className="opacity-50" />

                            <div className="flex items-center justify-between">
                              <span className="text-sm">
                                {tCommon("fields.createdBy")}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {user.createdBy
                                  ? user.createdBy.name
                                  : tCommon("fields.selfRegistered")}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm">
                                {tCommon("fields.emailVerified")}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {user.emailVerified ? (
                                  <DateFormatter
                                    date={user.emailVerified}
                                    formatString={
                                      session?.user.preferences?.dateFormat &&
                                      session?.user.preferences?.timeFormat
                                        ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat}`
                                        : session?.user.preferences?.dateFormat
                                    }
                                    timezone={
                                      session?.user.preferences?.timezone
                                    }
                                  />
                                ) : (
                                  tCommon("fields.unverified")
                                )}
                              </span>
                            </div>

                            <Separator className="opacity-50" />

                            <div className="flex items-center justify-between">
                              <span className="text-sm">
                                {tCommon("fields.usersCreated")}
                              </span>
                              <UserListDisplay
                                users={user.createdUsers as any}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Mentioned Comments - Only for own profile */}
                  {user?.id === session?.user?.id && (
                    <AccordionItem value="mentions">
                      <AccordionTrigger className="text-sm font-medium text-muted-foreground uppercase tracking-wide hover:no-underline">
                        {t("mentionedComments.title")}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="bg-muted/30 p-4 rounded-lg border mt-2">
                          <UserMentionedComments userId={userId} />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  return null;
};

export default UserProfile;

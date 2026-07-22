"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod/v4";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Star } from "lucide-react";
import { ProjectIcon } from "@/components/ProjectIcon";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  PasswordStrengthIndicator,
  type PasswordPolicy,
} from "@/components/PasswordStrengthIndicator";
import { Switch } from "@/components/ui/switch";
import type { Roles } from "~/zenstack/models";

interface AddUserProps {
  open: boolean;
  onClose: () => void;
}

export function AddUser({ open, onClose }: AddUserProps) {
  const t = useTranslations("admin.users.add");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletedUser, setDeletedUser] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const { mutateAsync: createManyProjectAssignment } =
    useClientQueries(schema).projectAssignment.useCreateMany();
  const { mutateAsync: createManyGroupAssignment } =
    useClientQueries(schema).groupAssignment.useCreateMany();

  // Fetch roles, projects, groups, and registration settings...
  const { data: roles } = useClientQueries(schema).roles.useFindMany();
  const defaultRoleId = roles?.find((role) => role.isDefault)?.id;
  const { data: registrationSettings } =
    useClientQueries(schema).registrationSettings.useFindFirst();

  // Email server configuration status
  const [isEmailServerConfigured, setIsEmailServerConfigured] = useState(true);

  // Mirrors the revoke-password pre-flight: a passwordless login path exists
  // when either an enabled MAGIC_LINK SSO provider is present or the email
  // server env vars are configured.
  const { data: magicLinkProvider } = useClientQueries(
    schema
  ).ssoProvider.useFindFirst({
    where: { type: "MAGIC_LINK", enabled: true },
    select: { id: true },
  });
  const passwordRequired = !magicLinkProvider && !isEmailServerConfigured;

  // Password policy pulled from RegistrationSettings — same source the user's
  // own ChangePasswordModal uses.
  const policy: PasswordPolicy | null = registrationSettings
    ? {
        minPasswordLength: registrationSettings.minPasswordLength,
        requireUppercase: registrationSettings.requireUppercase,
        requireLowercase: registrationSettings.requireLowercase,
        requireNumbers: registrationSettings.requireNumbers,
        requiredSpecialChars: registrationSettings.requiredSpecialChars,
      }
    : null;

  // Define a Zod schema specifically for form validation
  const AddUserFormValidationSchema = z
    .object({
      name: z.string().min(2, {
        message: tGlobal("common.fields.validation.nameRequired"),
      }),
      email: z
        .email()
        .min(1, { message: tGlobal("auth.signup.errors.emailRequired") }),
      password: z.string(),
      confirmPassword: z.string(),
      isActive: z.boolean(),
      access: z.enum(["ADMIN", "USER", "PROJECTADMIN", "NONE"]),
      roleId: z
        .string()
        .min(1, { message: tCommon("validation.roleRequired") }),
      isApi: z.boolean(),
      projects: z.array(z.number()).optional(),
      groups: z.array(z.number()).optional(),
    })
    .superRefine(({ confirmPassword, password }, ctx) => {
      if (passwordRequired && password.length === 0) {
        ctx.issues.push({
          code: "custom",
          message: t("fields.password_error"),
          path: ["password"],
          input: "",
        });
        return;
      }

      if (password.length === 0) {
        return;
      }

      if (policy) {
        if (password.length < policy.minPasswordLength) {
          ctx.issues.push({
            code: "custom",
            message: tGlobal("passwordStrength.minLength", {
              count: policy.minPasswordLength,
            }),
            path: ["password"],
            input: "",
          });
        }
        if (policy.requireUppercase && !/[A-Z]/.test(password)) {
          ctx.issues.push({
            code: "custom",
            message: tGlobal("passwordStrength.uppercase"),
            path: ["password"],
            input: "",
          });
        }
        if (policy.requireLowercase && !/[a-z]/.test(password)) {
          ctx.issues.push({
            code: "custom",
            message: tGlobal("passwordStrength.lowercase"),
            path: ["password"],
            input: "",
          });
        }
        if (policy.requireNumbers && !/[0-9]/.test(password)) {
          ctx.issues.push({
            code: "custom",
            message: tGlobal("passwordStrength.numbers"),
            path: ["password"],
            input: "",
          });
        }
        if (
          policy.requiredSpecialChars &&
          ![...policy.requiredSpecialChars].some((c) => password.includes(c))
        ) {
          ctx.issues.push({
            code: "custom",
            message: tGlobal("passwordStrength.specialChars", {
              chars: policy.requiredSpecialChars,
            }),
            path: ["password"],
            input: "",
          });
        }
      }

      if (confirmPassword !== password) {
        ctx.issues.push({
          code: "custom",
          message: tGlobal("auth.signup.errors.passwordsDoNotMatch"),
          path: ["confirmPassword"],
          input: "",
        });
      }
    });

  // Add roleOptions mapping here
  const roleOptions =
    roles?.map((role: Roles) => ({
      // Add type annotation for role
      value: role.id.toString(),
      label: (
        <span className="inline-flex items-center gap-1">
          {role.name}
          {role.isDefault && (
            <Tooltip>
              <TooltipTrigger className="ms-1" asChild>
                <Badge variant="secondary">
                  <Star className="h-3 w-3 fill-current text-primary-background" />
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{tCommon("defaultOption")}</TooltipContent>
            </Tooltip>
          )}
        </span>
      ),
    })) || [];

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  type ProjectOption = NonNullable<typeof projects>[number];

  const fetchProjectOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.toLowerCase();
      const filtered = (projects ?? []).filter((project) =>
        project.name.toLowerCase().includes(q)
      );
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [projects]
  );

  const { data: groups } = useClientQueries(schema).groups.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  type GroupOption = NonNullable<typeof groups>[number];

  const fetchGroupOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.toLowerCase();
      const filtered = (groups ?? []).filter((group) =>
        group.name.toLowerCase().includes(q)
      );
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [groups]
  );

  // Use the new form-specific validation schema
  const form = useForm<z.infer<typeof AddUserFormValidationSchema>>({
    resolver: standardSchemaResolver(AddUserFormValidationSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      isActive: true,
      access: "USER" as const,
      roleId: defaultRoleId ? defaultRoleId.toString() : "",
      isApi: false,
      projects: [] as number[],
      groups: [] as number[],
    },
  });

  const {
    setValue,
    control,
    formState: { errors },
  } = form;

  // Watch access field for conditional rendering (useWatch is safe for render)
  const accessValue = useWatch({ control, name: "access" });

  useEffect(() => {
    if (roles) {
      const defaultRole = roles.find((role) => role.isDefault);
      if (defaultRole && !form.getValues("roleId")) {
        // Set only if not already set
        setValue("roleId", defaultRole.id.toString());
      }
    }
  }, [roles, setValue, form]);

  // Check if email server is configured
  useEffect(() => {
    const checkEmailServerConfig = async () => {
      try {
        const response = await fetch("/api/admin/sso/magic-link-status");
        if (response.ok) {
          const data = await response.json();
          setIsEmailServerConfigured(data.configured);
        }
      } catch (error) {
        console.error("Failed to check email server configuration:", error);
      }
    };

    void checkEmailServerConfig();
  }, []);

  // Function to restore deleted user
  async function handleRestoreUser(
    userId: string,
    formData: z.infer<typeof AddUserFormValidationSchema>
  ) {
    try {
      setIsSubmitting(true);

      // Restore the user by marking isDeleted as false
      // Note: We only restore the user, not update their info. Admin can edit after restoration.
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isDeleted: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to restore user");
      }

      // Handle project and group assignments
      if (Array.isArray(formData.projects) && formData.projects.length > 0) {
        await createManyProjectAssignment({
          data: formData.projects.map((projectId: number) => ({
            userId: userId,
            projectId: projectId,
          })),
        });
      }
      if (Array.isArray(formData.groups) && formData.groups.length > 0) {
        await createManyGroupAssignment({
          data: formData.groups.map((groupId: number) => ({
            userId: userId,
            groupId: groupId,
          })),
        });
      }

      // Refetch all queries to update the user list immediately (optimistic update)
      void queryClient.refetchQueries();

      setShowRestoreDialog(false);
      setDeletedUser(null);
      onClose();
      setIsSubmitting(false);
    } catch {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
    }
  }

  // Update onSubmit to use the form validation schema type and construct API payload
  async function onSubmit(data: z.infer<typeof AddUserFormValidationSchema>) {
    setIsSubmitting(true);
    try {
      // Check if email verification is required
      // Email verification is automatically disabled if no email server is configured
      const requireEmailVerification =
        isEmailServerConfigured &&
        (registrationSettings?.requireEmailVerification ?? true);

      // If the admin skipped the password (allowed when a passwordless login
      // method is available), store an unusable random secret — same pattern as
      // SAML auto-provisioning in app/api/auth/callback/saml/route.ts. User
      // signs in via magic link / SSO.
      const passwordForApi =
        data.password.length > 0 ? data.password : crypto.randomUUID();

      // Construct payload for the new admin create endpoint. The server
      // does atomic soft-delete detection and returns RESTORE_REQUIRED /
      // EXISTS_ACTIVE / 201 — collapsing the previous P2002 + follow-up
      // findFirst race into one round-trip.
      const apiPayload = {
        name: data.name,
        email: data.email,
        password: passwordForApi,
        access: data.access,
        roleId: parseInt(data.roleId),
        isActive: data.isActive,
        isApi: data.isApi,
        emailVerified: requireEmailVerification ? undefined : null,
      };

      const response = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });

      if (response.status === 409) {
        const errBody = await response.json().catch(() => ({}));
        if (errBody?.code === "RESTORE_REQUIRED") {
          setDeletedUser({
            id: errBody.userId,
            name: errBody.name,
            email: errBody.email,
          });
          setShowRestoreDialog(true);
          setIsSubmitting(false);
          return;
        }
        if (errBody?.code === "EXISTS_ACTIVE") {
          form.setError("root", {
            type: "custom",
            message: tGlobal("common.errors.emailExists"),
          });
          setIsSubmitting(false);
          return;
        }
        // Unknown 409 shape — surface generic error.
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
        setIsSubmitting(false);
        return;
      }

      if (!response.ok) {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
        setIsSubmitting(false);
        return;
      }

      const { data: newUser } = await response.json();

      // Project / group assignments stay client-side. They're independent
      // of "create a user" and would bloat the server endpoint.
      if (Array.isArray(data.projects) && data.projects.length > 0) {
        await createManyProjectAssignment({
          data: data.projects.map((projectId: number) => ({
            userId: newUser.id,
            projectId: projectId,
          })),
        });
      }
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        await createManyGroupAssignment({
          data: data.groups.map((groupId: number) => ({
            userId: newUser.id,
            groupId: groupId,
          })),
        });
      }

      // Refetch all queries to update the user list immediately (optimistic update)
      void queryClient.refetchQueries();

      onClose();
      setIsSubmitting(false);
    } catch (err) {
      console.error("[AddUser] submit error:", err);
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t("title")}</DialogTitle>
                <DialogDescription className="sr-only">
                  {t("title")}
                </DialogDescription>
              </DialogHeader>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("name")}
                      <HelpPopover helpKey="user.name" />
                    </FormLabel>
                    <FormControl>
                      <Input placeholder={tCommon("name")} {...field} />
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
                      {tCommon("fields.email")}
                      <HelpPopover helpKey="user.email" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tCommon("fields.email")}
                        className="resize-none"
                        maxLength={256}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.password")}
                      {!passwordRequired && (
                        <span className="text-muted-foreground text-xs ms-2">
                          {"("}
                          {tCommon("fields.optional")}
                          {")"}
                        </span>
                      )}
                      <HelpPopover helpKey="user.password" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={tCommon("fields.password")}
                        className="resize-none"
                        maxLength={256}
                        {...field}
                      />
                    </FormControl>
                    {!passwordRequired && !field.value && (
                      <p className="text-muted-foreground text-xs">
                        {t("fields.passwordOptionalHelp")}
                      </p>
                    )}
                    <PasswordStrengthIndicator
                      password={field.value}
                      policy={policy}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.confirmPassword")}
                      {!passwordRequired && (
                        <span className="text-muted-foreground text-xs ms-2">
                          {"("}
                          {tCommon("fields.optional")}
                          {")"}
                        </span>
                      )}
                      <HelpPopover helpKey="user.confirmPassword" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={tCommon("fields.confirmPassword")}
                        className="resize-none"
                        maxLength={256}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.isActive")}
                      <HelpPopover helpKey="user.active" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="access"
                render={({ field: _field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormLabel className="flex whitespace-nowrap items-center">
                      {tCommon("fields.access")}
                      <HelpPopover helpKey="user.access" />
                      <FormControl>
                        <Controller
                          control={control}
                          name="access"
                          render={({ field: { onChange, value } }) => (
                            <Select
                              onValueChange={(newValue) => {
                                onChange(newValue);
                                // Auto-enable isApi for ADMIN users
                                if (newValue === "ADMIN") {
                                  setValue("isApi", true);
                                }
                              }}
                              value={value}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={tCommon("fields.access")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="ADMIN">
                                    {tCommon("access.admin")}
                                  </SelectItem>
                                  <SelectItem value="PROJECTADMIN">
                                    {tCommon("access.projectAdmin")}
                                  </SelectItem>
                                  <SelectItem value="USER">
                                    {tCommon("access.user")}
                                  </SelectItem>
                                  <SelectItem value="NONE">
                                    {tCommon("access.none")}
                                  </SelectItem>
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormControl>
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.role")}
                      <HelpPopover helpKey="user.role" />
                    </FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={tCommon("fields.role_placeholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {roleOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="groups"
                render={() => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.groups")}
                      <HelpPopover helpKey="user.groups" />
                    </FormLabel>
                    <FormControl>
                      <Controller
                        control={control}
                        name="groups"
                        render={({ field }) => {
                          const selectedGroups = (groups ?? []).filter(
                            (group) => field.value?.includes(group.id)
                          );
                          return (
                            <MultiAsyncCombobox<GroupOption>
                              value={selectedGroups}
                              onValueChange={(selected) =>
                                field.onChange(
                                  selected.map((group) => group.id)
                                )
                              }
                              fetchOptions={fetchGroupOptions}
                              renderOption={(group) => (
                                <span className="truncate">{group.name}</span>
                              )}
                              renderSelectedOption={(group) => (
                                <span>{group.name}</span>
                              )}
                              getOptionValue={(group) => group.id}
                              getOptionLabel={(group) => group.name}
                              placeholder={tCommon("fields.groups")}
                              className="w-full"
                              pageSize={20}
                              showTotal
                            />
                          );
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="projects"
                render={() => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.projects")}
                      <HelpPopover helpKey="user.projects" />
                    </FormLabel>
                    <FormControl>
                      <Controller
                        control={control}
                        name="projects"
                        render={({ field }) => {
                          const selectedProjects = (projects ?? []).filter(
                            (project) => field.value?.includes(project.id)
                          );
                          return (
                            <MultiAsyncCombobox<ProjectOption>
                              value={selectedProjects}
                              onValueChange={(selected) =>
                                field.onChange(
                                  selected.map((project) => project.id)
                                )
                              }
                              fetchOptions={fetchProjectOptions}
                              renderOption={(project) => (
                                <div className="flex min-w-0 items-center gap-2">
                                  <ProjectIcon
                                    iconUrl={project.iconUrl}
                                    width={16}
                                    height={16}
                                  />
                                  <span className="truncate">
                                    {project.name}
                                  </span>
                                </div>
                              )}
                              renderSelectedOption={(project) => (
                                <span>{project.name}</span>
                              )}
                              getOptionValue={(project) => project.id}
                              getOptionLabel={(project) => project.name}
                              placeholder={tCommon("fields.projects")}
                              className="w-full"
                              pageSize={20}
                              showTotal
                            />
                          );
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isApi"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={accessValue === "ADMIN"}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.apiAccess")}
                      {accessValue === "ADMIN" && (
                        <span className="text-muted-foreground text-xs ms-2">
                          {"("}
                          {tCommon("fields.requiredForAdmin")}
                          {")"}
                        </span>
                      )}
                      <HelpPopover helpKey="user.api" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                {errors.root && (
                  <div
                    className="bg-destructive text-destructive-foreground text-sm p-2"
                    role="alert"
                  >
                    {errors.root.message}
                  </div>
                )}
                <Button variant="outline" type="button" onClick={onClose}>
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? tCommon("actions.submitting")
                    : tCommon("actions.submit")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Restore Deleted User Dialog */}
      <Dialog
        open={showRestoreDialog}
        onOpenChange={(isOpen) => {
          setShowRestoreDialog(isOpen);
          if (!isOpen) {
            setDeletedUser(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{tGlobal("admin.users.restore.title")}</DialogTitle>
            <DialogDescription>
              {tGlobal("admin.users.restore.description", {
                email: deletedUser?.email ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setShowRestoreDialog(false);
                setDeletedUser(null);
                setIsSubmitting(false);
              }}
              disabled={isSubmitting}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!deletedUser) return;
                const formData = form.getValues();
                void handleRestoreUser(deletedUser.id, formData);
              }}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? tCommon("actions.submitting")
                : tGlobal("admin.users.restore.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

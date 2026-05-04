import DynamicIcon from "@/components/DynamicIcon";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { PlusSquare } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { importGeneratedTestCases } from "~/app/actions/importGeneratedTestCases";
import {
  useFindFirstRepositoryCases,
  useFindFirstRepositoryFolders,
  useFindFirstTemplates,
  useFindManyWorkflows,
} from "~/lib/hooks";
import { IconName } from "~/types/globals";

function buildFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(2, {
      error: t("common.errors.caseNameRequired"),
    }),
    workflowId: z
      .number({
        error: (issue) =>
          issue.input === undefined
            ? t("common.errors.caseStateRequired")
            : undefined,
      })
      .refine((value) => !isNaN(value), {
        error: t("common.errors.caseStateInvalid"),
      }),
  });
}

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface AddCaseRowProps {
  folderId: number;
}

export function AddCaseRow({ folderId }: AddCaseRowProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { data: session } = useSession();
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const { data: folder } = useFindFirstRepositoryFolders(
    {
      where: {
        id: folderId,
        isDeleted: false,
      },
      include: {
        repository: true,
        project: true,
      },
    },
    {
      enabled: !!folderId,
    }
  );

  const { data: maxOrder } = useFindFirstRepositoryCases(
    {
      where: {
        folderId: folderId,
      },
      orderBy: {
        order: "desc",
      },
      select: {
        order: true,
      },
    },
    {
      enabled: !!folderId,
    }
  );

  const { data: template } = useFindFirstTemplates(
    {
      where: {
        isDeleted: false,
        isDefault: true,
        projects: {
          some: {
            projectId: Number(projectId),
          },
        },
      },
    },
    {
      enabled: !!folderId,
    }
  );

  const { data: workflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      scope: "CASES",
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    include: {
      icon: true,
      color: true,
    },
    orderBy: {
      order: "asc",
    },
  });

  const defaultWorkflowId = workflows?.find(
    (workflow) => workflow.isDefault
  )?.id;

  const workflowOptions =
    workflows?.map((workflow) => ({
      value: workflow.id.toString(),
      label: (
        <div className="flex items-center shrink-0 max-w-full truncate">
          <DynamicIcon
            name={workflow.icon.name as IconName}
            color={workflow.color.value}
            className="shrink-0 w-5 h-5"
          />
          <div className="mx-1 truncate">{workflow.name}</div>
        </div>
      ),
    })) || [];

  const formSchema = useMemo(() => buildFormSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      workflowId: defaultWorkflowId,
    },
  });

  const {
    handleSubmit,
    reset,
    control,
    formState: { errors },
    setValue,
  } = form;

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (defaultWorkflowId) {
      setValue("workflowId", defaultWorkflowId);
    }
  }, [defaultWorkflowId, setValue]);

  useEffect(() => {
    reset({
      name: "",
      workflowId: defaultWorkflowId,
    });
  }, [reset, defaultWorkflowId]);

  const focusNameInput = () => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  };

  useEffect(() => {
    if (!isSubmitting && hasSubmitted) {
      focusNameInput();
    }
  }, [isSubmitting, hasSubmitted]);

  if (!session || !session.user.access) {
    return null;
  }

  const checkForDuplicates = async (caseName: string, caseId: number) => {
    try {
      const res = await fetch("/api/duplicate-scan/check-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: Number(projectId),
          caseId,
          name: caseName,
          tags: [],
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.cases && data.cases.length > 0) {
        const caseLinks = data.cases.map((c: { id: number; name: string }) =>
          React.createElement(
            "a",
            {
              key: c.id,
              href: `/${locale}/projects/repository/${projectId}/${c.id}`,
              target: "_blank",
              rel: "noopener noreferrer",
              style: {
                textDecoration: "underline",
                display: "block",
                marginTop: 4,
              },
            },
            c.name
          )
        );
        toast.warning(t("repository.duplicates.duplicateWarning"), {
          description: React.createElement(
            "div",
            null,
            t("repository.duplicates.duplicateWarningDescription", {
              count: data.cases.length,
            }),
            ...caseLinks,
            React.createElement(
              "a",
              {
                href: `/${locale}/projects/repository/${projectId}/duplicates`,
                target: "_blank",
                rel: "noopener noreferrer",
                style: {
                  textDecoration: "underline",
                  fontWeight: 500,
                  display: "block",
                  marginTop: 8,
                },
              },
              t("repository.duplicates.duplicateWarningReview")
            )
          ),
          duration: 15000,
        });
      }
    } catch {
      // Silently ignore — duplicate check is advisory only
    }
  };

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);
    try {
      if (session) {
        const result = await importGeneratedTestCases({
          projectId: Number(projectId),
          projectName: folder?.project?.name || "",
          repositoryId: folder?.repositoryId || 0,
          folderId,
          folderName: folder?.name || "",
          templateId: template?.id || 0,
          templateName: template?.templateName || "",
          stateId: data.workflowId,
          stateName:
            workflows?.find((w) => w.id === data.workflowId)?.name || "",
          maxOrder: maxOrder?.order ?? 0,
          autoGenerateTags: false,
          source: "MANUAL",
          testCases: [
            {
              id: crypto.randomUUID(),
              name: data.name,
              fieldValues: {},
              tags: [],
            },
          ],
          fieldMappings: [],
        });

        if (result.status === "error" || result.importedIds.length === 0) {
          throw new Error(
            result.message || result.errors[0] || "Import failed"
          );
        }

        const newCaseId = result.importedIds[0];

        await queryClient.invalidateQueries({
          queryKey: ["folderStats"],
          refetchType: "all",
        });

        await queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === "zenstack" &&
            query.queryKey[1] === "RepositoryCases",
          refetchType: "all",
        });

        reset({ name: "", workflowId: defaultWorkflowId });

        toast.success(t("common.errors.newTestCaseAdded"), {
          position: "bottom-right",
        });

        checkForDuplicates(data.name, newCaseId).catch(() => {});

        setIsSubmitting(false);
        setHasSubmitted(true);
      }
    } catch (err: any) {
      toast.error(t("repository.addCase.errorMessage"), {
        position: "bottom-right",
      });

      form.setError("root", {
        type: "custom",
        message: `An unknown error occurred. ${err.message}`,
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="flex items-center gap-1 rounded-lg mt-1 border-2 border-muted">
          <div className="m-1 mt-1 min-w-30">
            <FormField
              control={control}
              name="workflowId"
              render={({ field: _field }) => (
                <FormItem>
                  <FormControl>
                    <Controller
                      control={control}
                      name="workflowId"
                      render={({ field: { onChange, value } }) => (
                        <Select
                          onValueChange={(val) => onChange(Number(val))}
                          value={value ? value.toString() : ""}
                        >
                          <SelectTrigger className="bg-primary-foreground">
                            <SelectValue
                              placeholder={t("repository.addCase.selectState")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {workflowOptions.map((workflow) => (
                                <SelectItem
                                  key={workflow.value}
                                  value={workflow.value}
                                >
                                  {workflow.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </FormControl>
                  {/* <FormMessage /> */}
                </FormItem>
              )}
            />
          </div>
          <div className="w-full m-1 -mt-1">
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      disabled={isSubmitting}
                      placeholder={t("repository.addCase.namePlaceholder")}
                      {...field}
                      autoComplete="off"
                      data-testid="case-name-input"
                      ref={(e) => {
                        field.ref(e);
                        nameInputRef.current = e;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void handleSubmit(onSubmit)();
                        }
                      }}
                    />
                  </FormControl>
                  {/* <FormMessage /> */}
                </FormItem>
              )}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={isSubmitting}
            className="-mt-2 group mr-2 px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
            data-testid="inline-add-case-button"
          >
            {isSubmitting ? (
              <LoadingSpinner />
            ) : (
              <PlusSquare className="w-4 h-4 shrink-0" />
            )}
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
              {t("repository.cases.addCase")}
            </span>
          </Button>
        </div>
      </form>
      {errors.root && (
        <div
          className="bg-destructive text-destructive-foreground text-sm p-2"
          role="alert"
        >
          {errors.root.message}
        </div>
      )}
    </Form>
  );
}

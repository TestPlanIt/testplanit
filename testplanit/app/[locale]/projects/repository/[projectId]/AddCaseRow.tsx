import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import {
  useFindFirstRepositoryFolders,
  useFindFirstRepositoryCases,
  useFindFirstTemplates,
  useFindManyWorkflows,
  useCreateRepositoryCases,
  useCreateRepositoryCaseVersions,
} from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
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
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { PlusSquare } from "lucide-react";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useTranslations } from "next-intl";

const FormSchema = z.object({
  name: z.string().min(2, {
      error: "Please enter a name for the Test Case"
}),
  workflowId: z
    .number({
        error: (issue) => issue.input === undefined ? "Please select a State" : undefined
    })
    .refine((value) => !isNaN(value), {
        error: "Please select a valid State"
    }),
});

interface AddCaseRowProps {
  folderId: number;
}

export function AddCaseRow({ folderId }: AddCaseRowProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const { projectId } = useParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const { mutateAsync: createRepositoryCases } = useCreateRepositoryCases();
  const { mutateAsync: createRepositoryCaseVersions } =
    useCreateRepositoryCaseVersions();

  const { data: folder } = useFindFirstRepositoryFolders(
    {
      where: {
        id: folderId,
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

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
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
    watch,
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

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (session) {
        const newCase = await createRepositoryCases({
          data: {
            project: {
              connect: { id: Number(projectId) },
            },
            repository: {
              connect: { id: folder?.repositoryId },
            },
            folder: {
              connect: { id: folderId },
            },
            name: data.name,
            template: {
              connect: { id: template?.id || 0 },
            },
            state: {
              connect: { id: data.workflowId },
            },
            createdAt: new Date(),
            creator: {
              connect: { id: session.user.id },
            },
            order: maxOrder?.order ? maxOrder.order + 1 : 1,
          },
        });

        if (!newCase) throw new Error("Failed to create new case");

        // Create the initial version of the test case
        const newCaseVersion = await createRepositoryCaseVersions({
          data: {
            repositoryCase: {
              connect: { id: newCase.id },
            },
            project: {
              connect: { id: Number(projectId) },
            },
            staticProjectName: folder?.project?.name || "",
            staticProjectId: Number(projectId),
            repositoryId: folder?.repositoryId || 0,
            folderId: folderId,
            folderName: folder?.name || "",
            templateId: template?.id || 0,
            templateName: template?.templateName || "",
            name: data.name,
            stateId: data.workflowId,
            stateName:
              workflows?.find((w) => w.id === data.workflowId)?.name || "",
            createdAt: new Date(),
            creatorId: session.user.id,
            creatorName: session.user.name || "",
            isArchived: false,
            isDeleted: false,
            version: 1,
          },
        });

        if (!newCaseVersion)
          throw new Error("Failed to create new case version");

        reset({ name: "", workflowId: defaultWorkflowId });

        toast.success("New Test Case Added", {
          position: "bottom-right",
        });

        setIsSubmitting(false);
        setHasSubmitted(true);
      }
    } catch (err: any) {
      toast.success("Unknown error adding new test case", {
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
          <div className="m-1 min-w-[120px]">
            <FormField
              control={control}
              name="workflowId"
              render={({ field }) => (
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
          <div className="w-full m-1">
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
                      ref={(e) => {
                        field.ref(e);
                        nameInputRef.current = e;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleSubmit(onSubmit)();
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
            className="mr-2"
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {isSubmitting ? <LoadingSpinner /> : <PlusSquare />}
                </TooltipTrigger>
                <TooltipContent>{t("repository.cases.addCase")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
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

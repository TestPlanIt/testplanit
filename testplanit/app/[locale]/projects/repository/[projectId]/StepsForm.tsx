import React, { useEffect, useMemo, useState, useRef } from "react";
import { useFieldArray, Control, useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormControl, FormLabel, FormMessage } from "@/components/ui/form";
import {
  PlusCircle,
  Trash2,
  MoveVertical,
  SearchCheck,
  ListOrdered,
  CircleSlash2,
  Layers,
} from "lucide-react";
import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import SortableStep from "./SortableStep";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import type { Editor } from "@tiptap/core";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Steps as PrismaSteps, SharedStepGroup, Prisma } from "@prisma/client";
import { useTranslations } from "next-intl";
import { emptyEditorContent } from "~/app/constants";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  useCreateSharedStepGroup,
  useCreateManySharedStepItem,
  useFindManySharedStepGroup,
  useFindManySharedStepItem,
} from "~/lib/hooks";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";

// Define a type that includes the count for AsyncCombobox
interface SharedStepGroupWithCount extends SharedStepGroup {
  _count?: {
    items?: number;
  };
}

// Define an enriched step type that includes the sharedStepGroup relation
interface EnrichedStep extends PrismaSteps {
  sharedStepGroup?: (SharedStepGroup & { name: string | null }) | null;
}

// Define a type for the items used in the form's field array
// 'step' and 'expectedResult' will store the TipTap JSON content directly
export type StepFormField = {
  id?: string; // react-hook-form useFieldArray's default key
  step?: any; // tiptap content
  expectedResult?: any; // tiptap content
  isShared?: boolean;
  sharedStepGroupId?: number | null;
  sharedStepGroupName?: string | null;
  originalId?: number; // This ID comes from the database for existing steps
  attachments?: any[]; // Define more specifically if possible
  placeholderId?: string; // for optimistic updates while image uploads
};

interface StepsFormProps {
  control: Control<any>;
  name: string;
  steps?: EnrichedStep[] | StepFormField[];
  readOnly?: boolean;
  projectId: number;
  onSharedStepCreated?: () => void;
  hideSharedStepsButtons?: boolean;
}

interface EditorUpdateEvent {
  editor: Editor;
}

const TipTapEditorWrapper: React.FC<{
  control: Control<any>;
  name: string;
  initialContent?: object;
  readOnly?: boolean;
  projectId: number;
}> = ({ control, name, initialContent, readOnly = false, projectId }) => {
  const { setValue } = useFormContext();

  const handleEditorUpdate = (content: any) => {
    if (!readOnly) {
      setValue(name, content);
    }
  };

  return (
    <TipTapEditor
      key={name}
      content={initialContent || emptyEditorContent}
      projectId={projectId.toString()}
      onUpdate={readOnly ? undefined : handleEditorUpdate}
      readOnly={readOnly}
      className="min-h-[100px]"
    />
  );
};

// New StepItem component
interface StepItemProps {
  field: any;
  index: number;
  control: Control<any>;
  namePrefix: string; // e.g., "steps"
  readOnly: boolean;
  openPopovers: boolean[];
  handlePopoverOpenChange: (index: number, isOpen: boolean) => void;
  handleRemove: (index: number) => void;
  isSelected: boolean;
  onToggleSelection: (index: number) => void;
  projectId: number;
}

const StepItem: React.FC<StepItemProps> = ({
  field,
  index,
  control,
  namePrefix,
  readOnly,
  openPopovers,
  handlePopoverOpenChange,
  handleRemove,
  isSelected,
  onToggleSelection,
  projectId,
}) => {
  const t = useTranslations("repository.steps");
  const tCommon = useTranslations("common");

  // Fetch items if this is a shared step group placeholder
  const {
    data: sharedItemsData,
    isLoading: sharedItemsIsLoading,
    // error: sharedItemsError, // TODO: Handle error display
  } = useFindManySharedStepItem(
    {
      where: { sharedStepGroupId: field.sharedStepGroupId },
      orderBy: { order: "asc" },
    },
    { enabled: !!field.isShared && !!field.sharedStepGroupId }
  );

  const memoizedStepContent = useMemo(() => {
    try {
      return typeof field.step === "string"
        ? JSON.parse(field.step)
        : field.step || emptyEditorContent;
    } catch (e) {
      console.error("Error parsing step content for StepItem:", e);
      return emptyEditorContent;
    }
  }, [field.step]);

  const memoizedExpectedResultContent = useMemo(() => {
    try {
      return typeof field.expectedResult === "string"
        ? JSON.parse(field.expectedResult)
        : field.expectedResult || emptyEditorContent;
    } catch (e) {
      console.error("Error parsing expectedResult content for StepItem:", e);
      return emptyEditorContent;
    }
  }, [field.expectedResult]);

  // Render for Shared Step Group Placeholder
  if (field.isShared) {
    return (
      <SortableStep key={field.id} id={field.id} readOnly={readOnly}>
        {({ attributes, listeners, setNodeRef }) => (
          <div
            ref={setNodeRef}
            className="flex flex-col items-start min-w-[650px] bg-muted/75 p-2 rounded-lg mb-2 border-2 border-primary/30"
          >
            <div className="flex items-center justify-between pb-2 space-x-2 cursor-default w-full">
              <div className="flex items-center">
                {!readOnly && (
                  <div
                    {...attributes}
                    {...listeners}
                    className="cursor-ns-resize mr-2"
                  >
                    <MoveVertical className="h-4 w-4" />
                  </div>
                )}
                <FormLabel className="font-bold flex items-center">
                  <Layers className="h-5 w-5 ml-2 mr-1" />
                  {t("sharedStepGroupTitle", {
                    name: field.sharedStepGroupName || "",
                  })}
                </FormLabel>
              </div>
              {!readOnly && (
                <Popover
                  open={
                    openPopovers[index] === undefined
                      ? false
                      : openPopovers[index]
                  }
                  onOpenChange={(isOpen) =>
                    handlePopoverOpenChange(index, isOpen)
                  }
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      className="ml-auto"
                      data-testid={`delete-step-${index}`}
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-fit max-w-md" side="bottom">
                    {t("confirmDeleteSharedStepBlock", {
                      name: field.sharedStepGroupName || "this block",
                    })}
                    <div className="flex items-start justify-between gap-4 mt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => handlePopoverOpenChange(index, false)}
                      >
                        <CircleSlash2 className="h-4 w-4" />
                        {tCommon("cancel")}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          handleRemove(index);
                          handlePopoverOpenChange(index, false);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("removeBlockButton")}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {/* Display individual shared steps (read-only) */}
            {sharedItemsIsLoading && (
              <p className="ml-6 text-sm text-muted-foreground">
                {t("loadingSharedStepsItems")}
              </p>
            )}
            {/* TODO: Handle sharedItemsError display */}
            {sharedItemsData && sharedItemsData.length > 0 && (
              <div className="w-full mt-1">
                {sharedItemsData.map((item, itemIndex) => {
                  let stepContentToRender: object = emptyEditorContent;
                  try {
                    if (item.step && typeof item.step === "object") {
                      stepContentToRender = item.step as object; // Already an object
                    } else if (typeof item.step === "string") {
                      stepContentToRender = JSON.parse(item.step);
                    }
                  } catch (e) {
                    console.error(
                      "Error parsing shared item step content:",
                      e,
                      item.step
                    );
                    // stepContentToRender remains emptyEditorContent
                  }

                  let expectedResultContentToRender: object =
                    emptyEditorContent;
                  try {
                    if (
                      item.expectedResult &&
                      typeof item.expectedResult === "object"
                    ) {
                      expectedResultContentToRender =
                        item.expectedResult as object;
                    } else if (typeof item.expectedResult === "string") {
                      expectedResultContentToRender = JSON.parse(
                        item.expectedResult
                      );
                    }
                  } catch (e) {
                    console.error(
                      "Error parsing shared item expectedResult content:",
                      e,
                      item.expectedResult
                    );
                    // expectedResultContentToRender remains emptyEditorContent
                  }

                  return (
                    <div
                      key={item.id || itemIndex}
                      className="ml-6 mt-1 p-2 border-l-2 border-dashed border-primary/20"
                    >
                      <Label className="mb-1 flex items-center font-semibold">
                        <ListOrdered className="mr-1 h-5 w-5 shrink-0" />
                        {tCommon("fields.step")} {item.order + 1}
                      </Label>

                      <TipTapEditor
                        content={stepContentToRender}
                        readOnly={true}
                        projectId={projectId.toString()}
                        className="min-h-10 bg-background/50 p-1 rounded text-sm"
                      />
                      <Label className="mt-4 mb-1 flex items-center font-semibold">
                        <SearchCheck className="mr-1 h-5 w-5 shrink-0" />
                        {tCommon("fields.expectedResult")}
                      </Label>
                      <TipTapEditor
                        content={expectedResultContentToRender}
                        readOnly={true}
                        projectId={projectId.toString()}
                        className="min-h-10 bg-background/50 p-1 rounded text-sm"
                      />
                      <Separator className="my-2 bg-primary/30 w-full" />
                    </div>
                  );
                })}
              </div>
            )}
            {sharedItemsData && sharedItemsData.length === 0 && (
              <p className="ml-6 text-sm text-muted-foreground">
                {t("noStepsInSharedGroup")}
              </p>
            )}
            <FormMessage />
          </div>
        )}
      </SortableStep>
    );
  }

  // Render for Regular Step (existing logic)
  return (
    <SortableStep key={field.id} id={field.id} readOnly={readOnly}>
      {({ attributes, listeners, setNodeRef }) => (
        <div
          ref={setNodeRef}
          className="flex flex-col items-start min-w-[650px] bg-muted p-2 pb-1 rounded-lg mb-2"
        >
          <div className="flex items-center justify-between pb-2 space-x-2 cursor-default w-full">
            <div className="flex items-center">
              {!readOnly && (
                <Checkbox
                  id={`select-step-${index}`}
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelection(index)}
                  className="mr-2 ml-1"
                  aria-label={`Select step ${index + 1}`}
                />
              )}
              {!readOnly && (
                <div
                  {...attributes}
                  {...listeners}
                  className="cursor-ns-resize"
                >
                  <MoveVertical className="h-4 w-4" />
                </div>
              )}
              <FormLabel className="font-bold flex items-center">
                <ListOrdered
                  className={`h-5 w-5 ml-${readOnly ? "2" : "6"} mr-1`}
                />
                {tCommon("fields.step")} {index + 1}
              </FormLabel>
            </div>
            {!readOnly && (
              <Popover
                open={
                  openPopovers[index] === undefined
                    ? false
                    : openPopovers[index]
                }
                onOpenChange={(isOpen) =>
                  handlePopoverOpenChange(index, isOpen)
                }
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    className="ml-auto"
                    data-testid={`delete-step-${index}`}
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-fit" side="bottom">
                  {t("confirmDelete", { number: index + 1 })}
                  <div className="flex items-start justify-between gap-4 mt-2">
                    <div className="flex items-center mb-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="ml-auto"
                        onClick={() => handlePopoverOpenChange(index, false)}
                      >
                        <CircleSlash2 className="h-4 w-4" />
                        {tCommon("cancel")}
                      </Button>
                    </div>
                    <div className="flex items-center">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          handleRemove(index);
                          handlePopoverOpenChange(index, false);
                        }}
                        className="ml-auto"
                      >
                        <Trash2 className="h-4 w-4" /> {t("delete")}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
          <div className="w-full ring-2 ring-primary/50 p-1 rounded-md bg-primary-foreground rounded-b-none">
            <FormControl>
              <TipTapEditorWrapper
                control={control}
                name={`${namePrefix}.${index}.step`}
                initialContent={memoizedStepContent}
                readOnly={readOnly}
                projectId={projectId}
              />
            </FormControl>
          </div>
          <div className="w-full ring-2 ring-primary/50 p-1 rounded-md bg-primary-foreground mb-2 rounded-t-none">
            <FormLabel className="font-bold flex items-center">
              <SearchCheck className="h-5 w-5 mr-1" />
              {tCommon("fields.expectedResult")}
            </FormLabel>
            <FormControl>
              <TipTapEditorWrapper
                control={control}
                name={`${namePrefix}.${index}.expectedResult`}
                initialContent={memoizedExpectedResultContent}
                readOnly={readOnly}
                projectId={projectId}
              />
            </FormControl>
          </div>
          <FormMessage />
        </div>
      )}
    </SortableStep>
  );
};

const StepsForm: React.FC<StepsFormProps> = ({
  control,
  name,
  steps,
  readOnly = false,
  projectId,
  onSharedStepCreated,
  hideSharedStepsButtons = false,
}) => {
  const tCommon = useTranslations("common");
  const tRepoSteps = useTranslations("repository.steps");
  const { data: session } = useSession();
  const { watch, setValue, getValues } = useFormContext();
  const { fields, append, remove, move, update, replace } = useFieldArray({
    control,
    name: name,
  });

  const createSharedStepGroupMutation = useCreateSharedStepGroup();
  const createManySharedStepItemMutation = useCreateManySharedStepItem();

  // Moved hook to top level
  const {
    data: allSharedStepGroupsData, // Renamed for clarity
    isLoading: isLoadingAllSharedStepGroups,
    // error: allSharedStepGroupsError, // TODO: Handle error display if needed
  } = useFindManySharedStepGroup({
    where: { projectId: projectId, isDeleted: false },
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true } } },
  });

  const sensors = useSensors(useSensor(PointerSensor));
  const [openPopovers, setOpenPopovers] = useState<boolean[]>([]);
  const [selectedStepIndices, setSelectedStepIndices] = useState<number[]>([]);
  const [showCreateSharedDialog, setShowCreateSharedDialog] = useState(false);
  const [showAddExistingSharedDialog, setShowAddExistingSharedDialog] =
    useState(false);
  const [newSharedGroupName, setNewSharedGroupName] = useState("");
  // State to hold the group selected in the "Add Existing" dialog
  const [selectedSharedGroupInDialog, setSelectedSharedGroupInDialog] =
    useState<SharedStepGroupWithCount | null>(null);

  // Fetch items for the shared group selected in the dialog
  const {
    data: itemsOfSelectedSharedGroup,
    isLoading: isLoadingItemsOfSelectedSharedGroup,
    // error: errorItemsOfSelectedSharedGroup, // TODO: Handle error
  } = useFindManySharedStepItem(
    {
      where: { sharedStepGroupId: selectedSharedGroupInDialog?.id },
      orderBy: { order: "asc" },
    },
    { enabled: !!selectedSharedGroupInDialog?.id } // Only fetch if a group is selected
  );

  // Keep track of the version of `steps` prop that was last used to initialize/replace the field array.
  // Using a ref to store the "processed" version of the steps prop.
  const processedStepsRef = useRef<string | null>(null);

  // Helper function to map Prisma.JsonValue to TipTap content, similar to parseJsonToTipTap
  const mapPrismaJsonToTipTapContent = (
    data: Prisma.JsonValue | undefined | null
  ): object => {
    if (data === null || data === undefined) return emptyEditorContent;
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          parsed.type === "doc" &&
          Array.isArray(parsed.content)
        ) {
          return parsed;
        }
        return emptyEditorContent;
      } catch (e) {
        if (data.trim() !== "") {
          return {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: data }] },
            ],
          };
        }
        return emptyEditorContent;
      }
    }
    // Check if data is an object and then if it has the required TipTap properties
    if (typeof data === "object" && data !== null) {
      const potentialTipTap = data as { type?: unknown; content?: unknown }; // Type assertion for property access
      if (
        potentialTipTap.type === "doc" &&
        Array.isArray(potentialTipTap.content)
      ) {
        return data as object; // It matches the structure, so return it as an object
      }
    }
    return emptyEditorContent;
  };

  function isEnrichedStep(step: any): step is EnrichedStep {
    return (
      typeof step === "object" &&
      "order" in step &&
      "isDeleted" in step &&
      "testCaseId" in step
    );
  }

  useEffect(() => {
    const currentStepsString = JSON.stringify(steps); // Serialize current steps prop for comparison

    if (currentStepsString !== processedStepsRef.current) {
      if (steps && steps.length > 0) {
        const initialFormSteps = steps.map((stepP) => {
          const isSharedPlaceholder = !!stepP.sharedStepGroupId;
          const mappedStep: StepFormField = {
            id: stepP.id?.toString(), // Ensure ID is string for RHF
            originalId: typeof stepP.id === "number" ? stepP.id : undefined,
            step: isSharedPlaceholder
              ? emptyEditorContent
              : mapPrismaJsonToTipTapContent(stepP.step),
            expectedResult: isSharedPlaceholder
              ? emptyEditorContent
              : mapPrismaJsonToTipTapContent(stepP.expectedResult),
            isShared: isSharedPlaceholder,
            sharedStepGroupId:
              typeof stepP.sharedStepGroupId === "number"
                ? stepP.sharedStepGroupId
                : undefined,
          };
          return mappedStep;
        });
        replace(initialFormSteps);
      } else {
        replace([]);
      }
      processedStepsRef.current = currentStepsString; // Update ref with the string of processed steps
    }
  }, [steps, replace]);

  useEffect(() => {
    setOpenPopovers(fields.map(() => false));
  }, [fields, fields.length]);

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      const oldIndex = fields.findIndex((field) => field.id === active.id);
      const newIndex = fields.findIndex((field) => field.id === over.id);
      move(oldIndex, newIndex);
      // Adjust selectedStepIndexes after move
      setSelectedStepIndices((prevSelected) => {
        const newSelected = [...prevSelected];
        const movedItemOriginalSelectedIndex = prevSelected.indexOf(oldIndex);
        const itemAtNewIndexOriginalSelectedIndex =
          prevSelected.indexOf(newIndex);

        if (movedItemOriginalSelectedIndex !== -1) {
          // The moved item was selected, update its index
          newSelected.splice(movedItemOriginalSelectedIndex, 1, newIndex);
        }
        if (
          itemAtNewIndexOriginalSelectedIndex !== -1 &&
          newIndex !== oldIndex
        ) {
          // An item that was at the newIndex (and selected) needs to be updated to oldIndex if it was swapped
          // This logic needs to be more robust if we allow swapping.
          // For now, if the target was selected, and it's not the moved item, its index might change.
          // This simple move might not correctly handle all selection permutations with drag/drop.
          // A safer bet is to map IDs if fields have persistent unique IDs beyond array index.
        }
        // For simplicity, if a move happens, it's often easier to clear selection
        // or re-validate. For now, let's try a simple update, but acknowledge complexity.
        // A robust solution would map selected field IDs before and after move.
        // Given fields have `id` (e.g., `field.id`), let's refine this:
        const selectedFieldIds = selectedStepIndices
          .map((idx) => fields[idx]?.id)
          .filter((id) => id);

        // Perform the move for react-hook-form
        // This part is already handled by `move(oldIndex, newIndex)`

        // After move, find new indexes of previously selected field IDs
        const newSelectedIdxs = [];
        const currentFields = [...fields];
        // Simulate the move in a temporary array to get correct IDs post-move
        const tempMovedItem = currentFields.splice(oldIndex, 1)[0];
        currentFields.splice(newIndex, 0, tempMovedItem);

        for (const id of selectedFieldIds) {
          const currentNewIndex = currentFields.findIndex((f) => f.id === id);
          if (currentNewIndex !== -1) {
            newSelectedIdxs.push(currentNewIndex);
          }
        }
        return newSelectedIdxs.sort((a, b) => a - b);
      });
    }
  };

  const handleRemoveStep = (index: number) => {
    remove(index);
    setSelectedStepIndices((prev) =>
      prev.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
    );
    handlePopoverOpenChange(index, false);
  };

  const handlePopoverOpenChange = (index: number, isOpen: boolean) => {
    setOpenPopovers((prev) => {
      const newOpenPopovers = [...prev];
      newOpenPopovers[index] = isOpen;
      return newOpenPopovers;
    });
  };

  const toggleStepSelection = (index: number) => {
    setSelectedStepIndices((prevSelected) =>
      prevSelected.includes(index)
        ? prevSelected.filter((i) => i !== index)
        : [...prevSelected, index].sort((a, b) => a - b)
    );
  };

  const handleCreateSharedStep = async () => {
    if (selectedStepIndices.length === 0 || !newSharedGroupName.trim()) {
      toast.error(
        tRepoSteps("notifications.noStepsSelectedOrNameEmptyWarning" as any)
      );
      return;
    }

    if (!session?.user?.id) {
      toast.error(tCommon("errors.unauthorized"));
      return;
    }
    const userId = session.user.id;

    const stepsToShare: StepFormField[] = selectedStepIndices.map(
      (index) => fields[index]
    );

    try {
      // 1. Create the SharedStepGroup
      const newSharedGroup = await createSharedStepGroupMutation.mutateAsync({
        data: {
          name: newSharedGroupName,
          projectId: projectId,
          createdById: userId,
        },
      });

      if (!newSharedGroup || !newSharedGroup.id) {
        toast.error(
          tRepoSteps("notifications.failedToCreateSharedGroupError" as any)
        );
        return;
      }

      // 2. Create SharedStepItems
      const itemsToCreate = stepsToShare.map((stepField, order) => ({
        step:
          typeof stepField.step === "string"
            ? stepField.step
            : JSON.stringify(stepField.step || emptyEditorContent),
        expectedResult:
          typeof stepField.expectedResult === "string"
            ? stepField.expectedResult
            : JSON.stringify(stepField.expectedResult || emptyEditorContent),
        order,
        sharedStepGroupId: newSharedGroup.id,
      }));

      await createManySharedStepItemMutation.mutateAsync({
        data: itemsToCreate,
      });

      // 3. Update the form: Remove original steps and add the shared group placeholder
      const newStepPlaceholder: StepFormField = {
        id: "shared-" + newSharedGroup.id + "-" + Date.now(), // Corrected ID generation
        isShared: true,
        sharedStepGroupId: newSharedGroup.id,
        step: emptyEditorContent,
        expectedResult: emptyEditorContent,
      };

      const sortedIndices = [...selectedStepIndices].sort((a, b) => b - a);
      sortedIndices.forEach((index) => remove(index));

      append(newStepPlaceholder);

      setSelectedStepIndices([]);
      setNewSharedGroupName("");
      setShowCreateSharedDialog(false);
      toast.success(
        tRepoSteps("notifications.sharedGroupCreatedSuccess" as any)
      );
      if (onSharedStepCreated) {
        onSharedStepCreated();
      }
    } catch (error) {
      console.error("Error creating shared step group:", error);
      toast.error(tRepoSteps("notifications.errorCreatingSharedGroup" as any));
    }
  };

  const handleAddExistingSharedStepGroup = (
    group: SharedStepGroupWithCount | null // Parameter is now the group to add
  ) => {
    if (group) {
      const newSharedStepData = {
        id: "shared-" + group.id + "-" + Date.now(), // Corrected ID generation
        sharedStepGroupId: group.id,
        isShared: true,
        step: emptyEditorContent, // Placeholder content for shared step blocks in the main form
        expectedResult: emptyEditorContent, // Placeholder content
      };
      append(newSharedStepData);
      setShowAddExistingSharedDialog(false); // Close dialog after adding
      setSelectedSharedGroupInDialog(null); // Reset selection
    }
  };

  // fetchOptions for AsyncCombobox now filters client-side data
  const fetchSharedStepGroupsForCombobox = async (
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ results: SharedStepGroupWithCount[]; total: number }> => {
    if (isLoadingAllSharedStepGroups || !allSharedStepGroupsData) {
      return { results: [], total: 0 };
    }
    const lowerCaseQuery = query.toLowerCase();
    // Correctly treat allSharedStepGroupsData as a direct array
    const typedData = (allSharedStepGroupsData ||
      []) as SharedStepGroupWithCount[];

    const filtered = typedData.filter((group) =>
      group.name.toLowerCase().includes(lowerCaseQuery)
    );

    const paginatedResults = filtered.slice(
      page * pageSize,
      (page + 1) * pageSize
    );

    return {
      results: paginatedResults,
      total: filtered.length,
    };
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
      data-testid="steps-form"
    >
      <SortableContext
        items={fields.map((field) => field.id!)} // Added non-null assertion for field.id
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3 mb-4" data-testid="steps-form">
          {fields.map((field, index) => {
            const stepField = field as StepFormField; // Type assertion
            return (
              <div key={stepField.id} data-testid={`step-editor-${index}`}>
                <StepItem
                  field={stepField}
                  index={index}
                  control={control}
                  namePrefix={name}
                  readOnly={readOnly}
                  openPopovers={openPopovers}
                  handlePopoverOpenChange={handlePopoverOpenChange}
                  handleRemove={() => handleRemoveStep(index)}
                  isSelected={selectedStepIndices.includes(index)}
                  onToggleSelection={toggleStepSelection}
                  projectId={projectId}
                />
              </div>
            );
          })}
        </div>
      </SortableContext>
      {!readOnly && (
        <div className="flex items-center space-x-2 mt-4">
          <div className="flex w-full justify-between">
            <div className="flex space-x-2">
              <Button
                type="button"
                variant="default"
                onClick={() =>
                  append({
                    step: JSON.stringify(emptyEditorContent),
                    expectedResult: JSON.stringify(emptyEditorContent),
                  })
                }
                disabled={readOnly}
                className="flex items-center"
                data-testid="add-step-button"
              >
                <PlusCircle className="h-5 w-5" />
                {tRepoSteps("add")}
              </Button>
              {!hideSharedStepsButtons && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAddExistingSharedDialog(true)}
                  disabled={readOnly}
                  className="flex items-center"
                >
                  <PlusCircle className="h-5 w-5" />
                  {tRepoSteps("addSharedSteps")}
                </Button>
              )}
            </div>
            {!hideSharedStepsButtons && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateSharedDialog(true)}
                disabled={readOnly || selectedStepIndices.length === 0}
                className="flex items-center"
              >
                <Layers className="h-5 w-5" />
                {tRepoSteps("createSharedSteps", {
                  number: selectedStepIndices.length || 0,
                })}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Create Shared Step Dialog */}
      <AlertDialog
        open={showCreateSharedDialog}
        onOpenChange={setShowCreateSharedDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <Layers className="h-5 w-5 mr-1" />
              {tRepoSteps("createSharedSteps", {
                number: selectedStepIndices.length || 0,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tRepoSteps("sharedStepsDescription", {
                number: selectedStepIndices.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder={tRepoSteps("sharedStepsNamePlaceholder" as any)}
            value={newSharedGroupName}
            onChange={(e) => setNewSharedGroupName(e.target.value)}
            className="mt-2"
          />
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel onClick={() => setNewSharedGroupName("")}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCreateSharedStep}
              disabled={!newSharedGroupName.trim()}
            >
              {tCommon("actions.create")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Existing Shared Step Group Dialog */}
      <AlertDialog
        open={showAddExistingSharedDialog}
        onOpenChange={(isOpen) => {
          setShowAddExistingSharedDialog(isOpen);
          if (!isOpen) {
            // Clear any selections or states related to this dialog if needed
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <Layers className="h-5 w-5 mr-1" />
              {tRepoSteps("selectSharedStepsTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tRepoSteps("selectSharedStepsDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-2">
            <AsyncCombobox<SharedStepGroupWithCount>
              className="w-full"
              value={selectedSharedGroupInDialog} // Controlled by new state
              onValueChange={setSelectedSharedGroupInDialog} // Update new state on change
              fetchOptions={fetchSharedStepGroupsForCombobox}
              // Use renderOption for displaying the option
              renderOption={(group: SharedStepGroupWithCount) => (
                <div className="flex items-center justify-between w-full">
                  {group.name}
                  <span className="text-xs text-muted-foreground ml-1">
                    {tRepoSteps("stepsCountLabel", {
                      count: group._count?.items || 0,
                    })}
                  </span>
                </div>
              )}
              // Use getOptionValue for the key/value of the option
              getOptionValue={(group: SharedStepGroupWithCount) => group.id}
              placeholder={tRepoSteps("searchSharedStepsPlaceholder")}
              pageSize={10}
              showTotal={true}
            />
          </div>

          {/* Display items of the selected shared group for review */}
          {selectedSharedGroupInDialog && (
            <div className="mt-4 max-h-[300px] overflow-y-auto p-2 border rounded-md bg-muted/50">
              <h4 className="font-semibold mb-2 text-sm">
                {tRepoSteps("reviewSelectedStepsTitle")}
              </h4>
              {isLoadingItemsOfSelectedSharedGroup && (
                <p className="text-sm text-muted-foreground">
                  {tRepoSteps("loadingSharedStepsItems")}
                </p>
              )}
              {/* TODO: Handle errorItemsOfSelectedSharedGroup */}
              {itemsOfSelectedSharedGroup &&
                itemsOfSelectedSharedGroup.length > 0 && (
                  <div className="space-y-3">
                    {itemsOfSelectedSharedGroup.map((item, itemIndex) => {
                      let stepContentToRender: object = emptyEditorContent;
                      try {
                        if (item.step && typeof item.step === "object") {
                          stepContentToRender = item.step as object;
                        } else if (typeof item.step === "string") {
                          stepContentToRender = JSON.parse(item.step);
                        }
                      } catch (e) {
                        console.error(
                          "Error parsing shared item step content for dialog:",
                          e,
                          item.step
                        );
                      }

                      let expectedResultContentToRender: object =
                        emptyEditorContent;
                      try {
                        if (
                          item.expectedResult &&
                          typeof item.expectedResult === "object"
                        ) {
                          expectedResultContentToRender =
                            item.expectedResult as object;
                        } else if (typeof item.expectedResult === "string") {
                          expectedResultContentToRender = JSON.parse(
                            item.expectedResult
                          );
                        }
                      } catch (e) {
                        console.error(
                          "Error parsing shared item expectedResult content for dialog:",
                          e,
                          item.expectedResult
                        );
                      }
                      return (
                        <div
                          key={item.id || itemIndex}
                          className="p-2 border-l-2 border-dashed border-primary/20 bg-background/70 rounded-r-md"
                        >
                          <div className="font-semibold text-xs mb-1 text-foreground/80">
                            {tCommon("fields.step")} {item.order + 1}
                          </div>
                          <TipTapEditor
                            content={stepContentToRender}
                            readOnly={true}
                            projectId={projectId.toString()}
                            className="min-h-[30px] bg-background/50 p-1 rounded text-xs"
                          />
                          <div className="font-semibold text-xs mt-1 mb-1 text-foreground/80">
                            {tCommon("fields.expectedResult")}
                          </div>
                          <TipTapEditor
                            content={expectedResultContentToRender}
                            readOnly={true}
                            projectId={projectId.toString()}
                            className="min-h-[30px] bg-background/50 p-1 rounded text-xs"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              {itemsOfSelectedSharedGroup &&
                itemsOfSelectedSharedGroup.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {tRepoSteps("noStepsInSelectedSharedGroup" as any)}
                  </p>
                )}
            </div>
          )}

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel
              onClick={() => {
                setShowAddExistingSharedDialog(false);
                setSelectedSharedGroupInDialog(null); // Reset selection on cancel
              }}
            >
              {tCommon("cancel")}
            </AlertDialogCancel>
            {/* Removed the Add button as selection now directly calls handleAddExistingSharedStepGroup */}
            {/* Re-add the Add button */}
            <AlertDialogAction
              onClick={() =>
                handleAddExistingSharedStepGroup(selectedSharedGroupInDialog)
              }
              disabled={!selectedSharedGroupInDialog} // Disable if no group is selected
            >
              {tRepoSteps("addSharedSteps")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DndContext>
  );
};

export default StepsForm;

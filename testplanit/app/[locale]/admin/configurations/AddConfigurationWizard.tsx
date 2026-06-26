"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormItem, FormLabel } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Combine,
  Component,
  ListChecks,
  PlusCircle,
  Save,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import { ProjectIcon } from "@/components/ProjectIcon";

import {
  arraysEqual,
  computeShiftRangeIds,
  generateCombinations,
  markCombinationsWithExisting,
  splitIntoColumns,
} from "./addConfigurationWizardUtils";

enum WizardStep {
  VARIANTS = 0,
  COMBINATIONS = 1,
  PROJECTS = 2,
  CONFIRMATION = 3,
}

const stepIcons = [Component, Combine, Boxes, ListChecks];

const AddConfigurationWizard = (): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>(
    WizardStep.VARIANTS
  );

  // Step 1 state — variant selection.
  const [selectedVariants, setSelectedVariants] = useState<number[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set()
  );
  // Per-category anchor for shift-click range selection, matching the
  // configurations table's range select behaviour.
  const [lastSelectedVariant, setLastSelectedVariant] = useState<{
    categoryId: number;
    variantId: number;
  } | null>(null);

  // Step 2 state — per-combination selection. `exists` flags combinations
  // that already match a saved configuration; they're rendered disabled so
  // the user can see which combinations are already configured.
  const [allCombinations, setAllCombinations] = useState<
    { combination: number[]; selected: boolean; exists: boolean }[]
  >([]);

  // Step 3 state — projects to associate with the configurations being
  // created. Empty array = leave the new configurations unassigned; the
  // admin can attach them to projects later.
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  // Anchor for shift-click range selection across the alphabetical projects
  // list, mirroring the per-category variant range select on step 1.
  const [lastSelectedProjectId, setLastSelectedProjectId] = useState<
    number | null
  >(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const t = useTranslations("admin.configurations");
  const tVariants = useTranslations("admin.configurations.variants.selection");
  const tCombinations = useTranslations("admin.configurations.combinations");
  const tCommon = useTranslations("common");

  const form = useForm();

  const { mutateAsync: createConfigurations } =
    useClientQueries(schema).configurations.useCreate();

  const { data: categories } = useClientQueries(
    schema
  ).configCategories.useFindMany({
    where: { isDeleted: false },
    include: {
      variants: {
        where: { isEnabled: true },
        orderBy: { name: "asc" },
      },
    },
  });

  const { data: existingConfigurations } = useClientQueries(
    schema
  ).configurations.useFindMany({
    where: { isDeleted: false },
    include: { variants: true },
  });

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, iconUrl: true },
  });

  const toggleProject = (projectId: number, event?: React.MouseEvent) => {
    // Shift+click selects every project between the last clicked one and
    // this one (additive — never unselects). The range walks the underlying
    // alphabetical `projects` array, which matches what the user reads
    // top-to-bottom across the column-major layout.
    if (
      event?.shiftKey &&
      lastSelectedProjectId !== null &&
      lastSelectedProjectId !== projectId &&
      projects
    ) {
      const rangeIds = computeShiftRangeIds(
        projects.map((p) => p.id),
        lastSelectedProjectId,
        projectId
      );
      if (rangeIds) {
        setSelectedProjectIds((prev) =>
          Array.from(new Set([...prev, ...rangeIds]))
        );
        setLastSelectedProjectId(projectId);
        return;
      }
    }

    setSelectedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
    setLastSelectedProjectId(projectId);
  };

  const selectAllProjects = () => {
    if (!projects) return;
    setSelectedProjectIds(projects.map((p) => p.id));
  };

  const deselectAllProjects = () => {
    setSelectedProjectIds([]);
    setLastSelectedProjectId(null);
  };

  // Expand every category by default once the data arrives.
  useEffect(() => {
    if (categories) {
      setExpandedCategories(new Set(categories.map((category) => category.id)));
    }
  }, [categories]);

  // Resolve a variant id to its display name across all categories.
  const getVariantName = useCallback(
    (variantId: number): string | undefined => {
      return categories
        ?.flatMap((cat) => cat.variants)
        .find((v) => v.id === variantId)?.name;
    },
    [categories]
  );

  const getCombinationLabel = useCallback(
    (combination: number[]): string => {
      return combination.map(getVariantName).filter(Boolean).join(", ");
    },
    [getVariantName]
  );

  // Derive every viable combination from the variants the user picked in
  // step 1 and mark which ones already match an existing configuration.
  const derivedCombinations = useMemo(() => {
    if (!categories || selectedVariants.length === 0) return [];
    const categoryMap = new Map<number, number[]>();
    selectedVariants.forEach((variantId) => {
      const category = categories.find((cat) =>
        cat.variants.some((variant) => variant.id === variantId)
      );
      if (category) {
        if (!categoryMap.has(category.id)) categoryMap.set(category.id, []);
        categoryMap.get(category.id)!.push(variantId);
      }
    });

    const combinations = generateCombinations([...categoryMap.values()]);
    return markCombinationsWithExisting(combinations, existingConfigurations);
  }, [selectedVariants, existingConfigurations, categories]);

  // Hydrate / re-hydrate the per-combination checkbox state when the user
  // re-enters step 2. New combinations default to selected; combinations that
  // already exist are kept visible but never selected (their checkbox is
  // disabled in the UI).
  useEffect(() => {
    if (currentStep !== WizardStep.COMBINATIONS) return;
    const items = derivedCombinations.map(({ combination, exists }) => ({
      combination,
      selected: !exists,
      exists,
    }));
    items.sort((a, b) =>
      getCombinationLabel(a.combination).localeCompare(
        getCombinationLabel(b.combination)
      )
    );
    setAllCombinations(items);
  }, [currentStep, derivedCombinations, getCombinationLabel]);

  const handleClose = () => {
    setOpen(false);
    setCurrentStep(WizardStep.VARIANTS);
    setSelectedVariants([]);
    setAllCombinations([]);
    setSelectedProjectIds([]);
    setIsSubmitting(false);
  };

  const handleVariantChange = (
    categoryId: number,
    variantId: number,
    event?: React.MouseEvent
  ) => {
    // Shift+click selects every variant between the last clicked one and this
    // one within the same category (additive — never unselects).
    if (
      event?.shiftKey &&
      lastSelectedVariant &&
      lastSelectedVariant.categoryId === categoryId
    ) {
      const category = categories?.find((cat) => cat.id === categoryId);
      if (category) {
        const rangeIds = computeShiftRangeIds(
          category.variants.map((v) => v.id),
          lastSelectedVariant.variantId,
          variantId
        );
        if (rangeIds) {
          setSelectedVariants((prev) =>
            Array.from(new Set([...prev, ...rangeIds]))
          );
          setLastSelectedVariant({ categoryId, variantId });
          return;
        }
      }
    }

    setSelectedVariants((prev) =>
      prev.includes(variantId)
        ? prev.filter((id) => id !== variantId)
        : [...prev, variantId]
    );
    setLastSelectedVariant({ categoryId, variantId });
  };

  const handleSelectAllInCategory = (categoryId: number, select: boolean) => {
    const category = categories?.find((cat) => cat.id === categoryId);
    if (!category) return;
    const variantIds = category.variants.map((v) => v.id);
    setSelectedVariants((prev) =>
      select
        ? [...prev, ...variantIds.filter((id) => !prev.includes(id))]
        : prev.filter((id) => !variantIds.includes(id))
    );
    if (!expandedCategories.has(categoryId)) {
      setExpandedCategories((prev) => new Set(prev).add(categoryId));
    }
  };

  const toggleCategory = (categoryId: number) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const handleCombinationToggle = (combination: number[]) => {
    setAllCombinations((prev) =>
      prev.map((item) =>
        arraysEqual(item.combination, combination) && !item.exists
          ? { ...item, selected: !item.selected }
          : item
      )
    );
  };

  const selectedCombinations = useMemo(
    () =>
      allCombinations
        .filter((item) => item.selected && !item.exists)
        .map((item) => item.combination),
    [allCombinations]
  );

  // No combinations are available to add when every derived combination
  // already exists (each one is rendered disabled).
  const noCombinationsAvailable =
    allCombinations.length === 0 ||
    allCombinations.every((item) => item.exists);

  const canProceed = () => {
    switch (currentStep) {
      case WizardStep.VARIANTS:
        return selectedVariants.length > 0;
      case WizardStep.COMBINATIONS:
        return (
          !noCombinationsAvailable &&
          allCombinations.some((item) => item.selected)
        );
      case WizardStep.PROJECTS:
        // Assigning projects is optional — admins can leave the new
        // configurations unassigned and attach them later.
        return true;
      case WizardStep.CONFIRMATION:
        return selectedCombinations.length > 0;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (!canProceed()) return;
    setCurrentStep((prev) =>
      Math.min(prev + 1, WizardStep.CONFIRMATION)
    ) as unknown as void;
  };

  const handleBack = () => {
    setCurrentStep((prev) =>
      Math.max(prev - 1, WizardStep.VARIANTS)
    ) as unknown as void;
  };

  const handleSubmit = async () => {
    if (selectedCombinations.length === 0) return;
    setIsSubmitting(true);
    try {
      for (const combination of selectedCombinations) {
        await createConfigurations({
          data: {
            name: getCombinationLabel(combination),
            variants: {
              create: combination.map((variantId) => ({
                variant: { connect: { id: variantId } },
              })),
            },
            // Optional: assign each new configuration to the projects the user
            // picked in step 3. The nested createMany attaches them
            // atomically with the configuration itself.
            ...(selectedProjectIds.length > 0
              ? {
                  projects: {
                    createMany: {
                      data: selectedProjectIds.map((projectId) => ({
                        projectId,
                      })),
                    },
                  },
                }
              : {}),
          },
        });
      }
      handleClose();
    } catch (error) {
      console.error("Error creating configurations:", error);
      setIsSubmitting(false);
    }
  };

  const isLastStep = currentStep === WizardStep.CONFIRMATION;

  const stepTitles = [
    tVariants("title"),
    tCombinations("selectCombination"),
    t("projectAssignment.title"),
    tCombinations("reviewTitle"),
  ];

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">
        <PlusCircle className="w-4" />
        <span className="hidden md:inline">{t("addConfiguration")}</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : handleClose())}
      >
        <DialogContent className="sm:max-w-[700px] lg:max-w-[900px] h-[80vh] flex flex-col overflow-hidden">
          <Form {...form}>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex flex-col flex-1 min-h-0 mt-4"
            >
              <DialogHeader className="mb-4">
                <DialogTitle className="flex items-center gap-2">
                  <CirclePlus className="h-5 w-5" />
                  {t("addConfiguration")}
                </DialogTitle>
                <DialogDescription>
                  {tVariants("description")}
                </DialogDescription>
              </DialogHeader>

              {/* Step indicator */}
              <div className="flex items-center gap-2 mb-4">
                {stepTitles.map((_, index) => {
                  const Icon = stepIcons[index];
                  const isClickable = index < currentStep;
                  return (
                    <div key={index} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => isClickable && setCurrentStep(index)}
                        disabled={!isClickable && index !== currentStep}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                          index < currentStep
                            ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90"
                            : index === currentStep
                              ? "bg-primary/10 text-primary border-2 border-primary"
                              : "bg-muted text-muted-foreground cursor-not-allowed"
                        }`}
                      >
                        {index < currentStep ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : (
                          <Icon className="w-5 h-5" />
                        )}
                      </button>
                      {index < stepTitles.length - 1 && (
                        <div
                          className={`w-12 h-0.5 mx-2 ${
                            index < currentStep ? "bg-primary" : "bg-muted"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="text-sm text-muted-foreground mb-2">
                {stepTitles[currentStep]}
              </div>

              <ScrollArea className="flex-1 min-h-0 pr-4">
                {currentStep === WizardStep.VARIANTS && (
                  <div className="space-y-4">
                    {categories
                      ?.filter((category) => category.variants.length > 0)
                      .map((category) => (
                        <FormItem key={category.id}>
                          <div className="flex items-center justify-between">
                            <FormLabel
                              className="flex items-center cursor-pointer"
                              onClick={() => toggleCategory(category.id)}
                            >
                              {expandedCategories.has(category.id) ? (
                                <ChevronDown className="mr-2" />
                              ) : (
                                <ChevronRight className="mr-2" />
                              )}
                              {category.name}
                            </FormLabel>
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={() =>
                                handleSelectAllInCategory(
                                  category.id,
                                  !category.variants.every((variant) =>
                                    selectedVariants.includes(variant.id)
                                  )
                                )
                              }
                            >
                              {category.variants.every((variant) =>
                                selectedVariants.includes(variant.id)
                              )
                                ? tCommon("actions.deselectAll")
                                : tCommon("actions.selectAll")}
                            </Button>
                          </div>
                          {expandedCategories.has(category.id) && (
                            // Three columns chunked from the alphabetical list
                            // so items flow column-1-top-to-bottom, then
                            // column-2, then column-3 — same pattern as
                            // ColumnSelection. Keeps shift+click range
                            // selection visually intuitive.
                            <div className="pl-6 flex gap-4">
                              {splitIntoColumns(category.variants, 3).map(
                                (colVariants, colIdx) => (
                                  <div
                                    key={colIdx}
                                    className="flex flex-col space-y-2 flex-1"
                                  >
                                    {colVariants.map((variant) => (
                                      <FormControl key={variant.id}>
                                        <Label className="flex items-center space-x-2 cursor-pointer select-none">
                                          <Checkbox
                                            checked={selectedVariants.includes(
                                              variant.id
                                            )}
                                            // No-op: parent owns selection via
                                            // the onClick handler below so we
                                            // can read shiftKey for range
                                            // select.
                                            onCheckedChange={() => {}}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              e.preventDefault();
                                              handleVariantChange(
                                                category.id,
                                                variant.id,
                                                e
                                              );
                                            }}
                                          />
                                          <span>{variant.name}</span>
                                        </Label>
                                      </FormControl>
                                    ))}
                                  </div>
                                )
                              )}
                            </div>
                          )}
                          <Separator />
                        </FormItem>
                      ))}
                  </div>
                )}

                {currentStep === WizardStep.COMBINATIONS && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {tCombinations("selectCombinationDescription")}
                    </p>
                    {allCombinations.length === 0 ? (
                      <div>{tCombinations("allExist")}</div>
                    ) : (
                      allCombinations.map(
                        ({ combination, selected, exists }, index) => (
                          <FormControl key={index}>
                            <Label
                              className={`flex items-center space-x-2 space-y-0 ${
                                exists
                                  ? "cursor-not-allowed opacity-60"
                                  : "cursor-pointer"
                              }`}
                            >
                              <Checkbox
                                checked={selected}
                                disabled={exists}
                                onCheckedChange={() =>
                                  handleCombinationToggle(combination)
                                }
                              />
                              <span>{getCombinationLabel(combination)}</span>
                              {exists && (
                                <span className="text-xs text-muted-foreground italic">
                                  {tCombinations("alreadyExists")}
                                </span>
                              )}
                            </Label>
                          </FormControl>
                        )
                      )
                    )}
                    {!noCombinationsAvailable && !canProceed() && (
                      <p className="text-destructive">
                        {tCombinations("selectAtLeast")}
                      </p>
                    )}
                  </div>
                )}

                {currentStep === WizardStep.PROJECTS && (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-muted-foreground">
                        {t("projectAssignment.description")}
                      </p>
                      {projects && projects.length > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={selectAllProjects}
                          >
                            {tCommon("actions.selectAll")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={deselectAllProjects}
                            disabled={selectedProjectIds.length === 0}
                          >
                            {tCommon("actions.deselectAll")}
                          </Button>
                        </div>
                      )}
                    </div>
                    {projects && projects.length > 0 ? (
                      <div className="flex gap-4">
                        {splitIntoColumns(projects, 3).map(
                          (colProjects, colIdx) => (
                            <div
                              key={colIdx}
                              className="flex flex-col space-y-2 flex-1"
                            >
                              {colProjects.map((project) => (
                                <FormControl key={project.id}>
                                  <Label className="flex items-center space-x-2 cursor-pointer select-none">
                                    <Checkbox
                                      checked={selectedProjectIds.includes(
                                        project.id
                                      )}
                                      // No-op: parent owns selection via the
                                      // onClick handler below so we can read
                                      // shiftKey for range select.
                                      onCheckedChange={() => {}}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        toggleProject(project.id, e);
                                      }}
                                    />
                                    <ProjectIcon
                                      iconUrl={project.iconUrl}
                                      width={16}
                                      height={16}
                                    />
                                    <span className="truncate">
                                      {project.name}
                                    </span>
                                  </Label>
                                </FormControl>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("projectAssignment.noProjects")}
                      </p>
                    )}
                  </div>
                )}

                {currentStep === WizardStep.CONFIRMATION && (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {tCombinations("confirmDescription", {
                          count: selectedCombinations.length,
                        })}
                      </p>
                      <div className="space-y-1">
                        {selectedCombinations.map((combination, index) => (
                          <FormItem key={index}>
                            <ConfigurationNameDisplay
                              name={getCombinationLabel(combination)}
                            />
                          </FormItem>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {t("projectAssignment.reviewLabel")}
                      </p>
                      {selectedProjectIds.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          {t("projectAssignment.noneAssigned")}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(projects ?? [])
                            .filter((p) => selectedProjectIds.includes(p.id))
                            .map((project) => (
                              <span
                                key={project.id}
                                className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-sm"
                              >
                                <ProjectIcon
                                  iconUrl={project.iconUrl}
                                  width={14}
                                  height={14}
                                />
                                <span className="truncate max-w-[200px]">
                                  {project.name}
                                </span>
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </ScrollArea>

              <DialogFooter className="flex items-center justify-between shrink-0 pt-4">
                <div className="flex items-center gap-2">
                  {currentStep > WizardStep.VARIANTS && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBack}
                      disabled={isSubmitting}
                      className="!gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {tCommon("actions.previous")}
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    disabled={isSubmitting}
                  >
                    {tCommon("cancel")}
                  </Button>
                  {isLastStep ? (
                    <Button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || !canProceed()}
                    >
                      <Save className="h-4 w-4" />
                      {isSubmitting
                        ? tCombinations("creating", {
                            count: selectedCombinations.length,
                          })
                        : tCombinations("createButton", {
                            count: selectedCombinations.length,
                          })}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleNext}
                      disabled={!canProceed()}
                      className="!gap-1"
                    >
                      {tCommon("actions.next")}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AddConfigurationWizard;

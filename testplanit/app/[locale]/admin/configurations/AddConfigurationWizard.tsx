"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useFindManyConfigCategories,
  useCreateConfigurations,
} from "~/lib/hooks";
import VariantSelectionDialog from "./VariantSelectionDialog";
import CombinationSelectionDialog from "./CombinationSelectionDialog";
import ConfirmationDialog from "./ConfirmationDialog";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

const AddConfigurationWizard = (): React.ReactElement => {
  const [step, setStep] = useState(0); // Start with step 0 to prevent the initial dialog from showing
  const [selectedVariants, setSelectedVariants] = useState<number[]>([]);
  const [selectedCombinations, setSelectedCombinations] = useState<number[][]>(
    []
  );
  const { mutateAsync: createConfigurations } = useCreateConfigurations();
  const t = useTranslations("admin.configurations");

  const { data: categories } = useFindManyConfigCategories({
    where: { isDeleted: false },
    include: { variants: true },
  });

  const handleNextVariants = (variants: number[]) => {
    setSelectedVariants(variants);
    setStep(2);
  };

  const handleNextCombinations = (combinations: number[][]) => {
    setSelectedCombinations(combinations);
    setStep(3);
  };

  const handlePrevious = () => {
    setStep((prev) => prev - 1);
  };

  const handleClose = () => {
    setStep(0);
    setSelectedVariants([]);
    setSelectedCombinations([]);
  };

  const handleSubmit = async (combinations: number[][]) => {
    try {
      for (const combination of combinations) {
        await createConfigurations({
          data: {
            name: combination
              .map(
                (variantId) =>
                  categories
                    ?.flatMap((cat) => cat.variants)
                    .find((v) => v.id === variantId)?.name
              )
              .filter(Boolean)
              .join(", "),
            variants: {
              create: combination.map((variantId) => ({
                variant: {
                  connect: { id: variantId },
                },
              })),
            },
          },
        });
      }
      handleClose();
    } catch (error) {
      console.error("Error creating configurations:", error);
    }
  };

  return (
    <>
      <Button onClick={() => setStep(1)} type="button">
        <PlusCircle className="w-4" />
        <span className="hidden md:inline">{t("addConfiguration")}</span>
      </Button>
      <VariantSelectionDialog
        open={step === 1}
        onClose={handleClose}
        onNext={handleNextVariants}
      />
      <CombinationSelectionDialog
        open={step === 2}
        onClose={handleClose}
        onPrevious={handlePrevious}
        selectedVariants={selectedVariants}
        onNext={handleNextCombinations}
        categories={categories || []} // Pass categories as a prop
      />
      <ConfirmationDialog
        open={step === 3}
        onClose={handleClose}
        onPrevious={handlePrevious}
        onSubmit={handleSubmit}
        selectedCombinations={selectedCombinations}
        categories={categories || []} // Pass categories as a prop
      />
    </>
  );
};

export default AddConfigurationWizard;

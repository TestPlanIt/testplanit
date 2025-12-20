"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Form, FormItem } from "@/components/ui/form";
import { useForm } from "react-hook-form";

interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onSubmit: (combinations: number[][]) => Promise<void>;
  selectedCombinations: number[][];
  categories: {
    id: number;
    name: string;
    variants: { id: number; name: string }[];
  }[];
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  open,
  onClose,
  onPrevious,
  onSubmit,
  selectedCombinations,
  categories,
}) => {
  const form = useForm();
  const { isSubmitting } = form.formState;
  const t = useTranslations("admin.configurations.combinations");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const handleSubmit = async () => {
    await onSubmit(selectedCombinations);
  };

  const getVariantName = (variantId: number) => {
    return categories
      ?.flatMap((cat) => cat.variants)
      .find((v) => v.id === variantId)?.name;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form
            className="space-y-2"
            onSubmit={form.handleSubmit(handleSubmit)}
          >
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <div className="text-muted-foreground text-sm">{tGlobal("common.fields.step")}</div>
            </DialogHeader>
            <DialogDescription>
              {t("description", {
                count: selectedCombinations?.length,
              })}
            </DialogDescription>
            <ScrollArea>
              <div className=" h-96 max-h-[400px] space-y-0">
                {selectedCombinations.map((combination, index) => (
                  <FormItem key={index}>
                    <Label>
                      {combination
                        .map(getVariantName)
                        .filter(Boolean)
                        .join(", ")}
                    </Label>
                  </FormItem>
                ))}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} type="button">
                {tCommon("actions.cancel")}
              </Button>
              <Button variant="outline" onClick={onPrevious} type="button">
                {tCommon("actions.previous")}
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
  );
};

export default ConfirmationDialog;

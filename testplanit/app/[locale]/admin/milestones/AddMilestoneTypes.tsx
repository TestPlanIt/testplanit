"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useCreateMilestoneTypes,
  useUpdateManyMilestoneTypes,
} from "~/lib/hooks";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CirclePlus } from "lucide-react";
import { FieldIconPicker } from "@/components/FieldIconPicker";

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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { HelpPopover } from "@/components/ui/help-popover";

export function AddMilestoneTypeModal() {
  const t = useTranslations("admin.milestones.add");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [selectedIconId, setSelectedIconId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const FormSchema = z.object({
    name: z.string().min(2, {
      message: t("fields.name_error"),
    }),
    isDefault: z.boolean(),
  });

  const { mutateAsync: createMilestoneType } = useCreateMilestoneTypes();
  const { mutateAsync: updateManyMilestoneTypes } =
    useUpdateManyMilestoneTypes();

  const handleCancel = () => setOpen(false);

  const handleIconSelect = (iconId: number) => {
    setSelectedIconId(iconId);
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      isDefault: false,
    },
  });

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (data.isDefault) {
        await updateManyMilestoneTypes({
          where: { isDefault: true },
          data: {
            isDefault: false,
          },
        });
      }
      await createMilestoneType({
        data: {
          name: data.name,
          iconId: selectedIconId,
          isDefault: data.isDefault,
        },
      });
      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: t("errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: t("errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CirclePlus className="w-4" />
          <span className="hidden md:inline">{t("button")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
            </DialogHeader>
            <div>
              <div className="w-16 h-full">
                <FormLabel className="whitespace-nowrap flex items-center">
                  {tCommon("fields.icon")}
                  <HelpPopover helpKey="milestoneType.icon" />
                </FormLabel>
                <FieldIconPicker
                  onIconSelect={(newIconId) => handleIconSelect(newIconId)}
                />
              </div>
            </div>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.name")}
                    <HelpPopover helpKey="milestoneType.name" />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={tCommon("fields.name")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="flex items-center !mt-0">
                    {tCommon("fields.default")}
                    <HelpPopover helpKey="milestoneType.isDefault" />
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
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("status.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

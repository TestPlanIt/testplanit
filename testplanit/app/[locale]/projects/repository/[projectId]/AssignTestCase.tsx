"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateTestRunCases } from "~/lib/hooks";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { ExtendedCases } from "./columns";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import {
  notifyTestCaseAssignment,
  notifyBulkTestCaseAssignment,
} from "~/app/actions/test-run-notifications";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { UserNameCell } from "@/components/tables/UserNameCell";

interface AssignTestCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  testRunId: number;
  testRunCaseId?: number;
  caseId: number;
  caseName: string;
  currentAssigneeId?: string | null;
  projectId: number;
  isBulkAssign?: boolean;
  selectedCases?: ExtendedCases[];
}

export function AssignTestCaseModal({
  isOpen,
  onClose,
  testRunId,
  testRunCaseId,
  caseId,
  caseName,
  currentAssigneeId,
  projectId,
  isBulkAssign = false,
  selectedCases = [],
}: AssignTestCaseModalProps) {
  const { data: session } = useSession();
  const t = useTranslations();
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    name: string;
    email: string | null;
    image: string | null;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update mutation
  const { mutateAsync: updateTestRunCase } = useUpdateTestRunCases();

  const handleAssign = async () => {
    setIsSubmitting(true);

    try {
      const selectedUserId = selectedUser?.id || null;

      if (isBulkAssign && selectedCases && selectedCases.length > 0) {
        // Bulk assignment
        const updatePromises = selectedCases
          .filter((c) => c.testRunCaseId) // Ensure testRunCaseId exists
          .map((c) =>
            updateTestRunCase({
              where: {
                id: c.testRunCaseId!,
              },
              data: {
                assignedToId: selectedUserId,
              },
            })
          );

        await Promise.all(updatePromises);

        // Send notification for bulk assignment
        if (selectedUserId) {
          const testRunCaseIds = selectedCases
            .filter((c) => c.testRunCaseId)
            .map((c) => c.testRunCaseId!);
          await notifyBulkTestCaseAssignment(
            testRunCaseIds,
            selectedUserId,
            projectId
          );
        }

        toast.success(
          selectedUserId
            ? t("common.success.bulkAssigned", {
                count: selectedCases.length,
              })
            : t("common.success.bulkUnassigned", {
                count: selectedCases.length,
              })
        );
      } else {
        // Single case assignment
        if (!testRunCaseId) {
          toast.error(t("common.errors.missingTestRunCase"));
          return;
        }

        await updateTestRunCase({
          where: {
            id: testRunCaseId,
          },
          data: {
            assignedToId: selectedUserId,
          },
        });

        // Send notification for single assignment
        if (selectedUserId && selectedUserId !== currentAssigneeId) {
          await notifyTestCaseAssignment(
            testRunCaseId,
            selectedUserId,
            currentAssigneeId
          );
        }

        toast.success(
          selectedUserId
            ? t("common.success.assigned")
            : t("common.success.unassigned")
        );
      }

      onClose();
    } catch (error) {
      console.error("Error assigning user:", error);
      toast.error(t("common.errors.somethingWentWrong"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get the appropriate dialog description based on selection mode
  const getDialogDescription = () => {
    if (isBulkAssign && selectedCases && selectedCases.length > 0) {
      return t("common.dialogs.assignBulk.description", {
        count: selectedCases.length,
      });
    }
    return t("common.dialogs.assign.description", { testCase: caseName });
  };

  // Determine if the assign button should be disabled
  const isAssignButtonDisabled = () => {
    const selectedUserId = selectedUser?.id || null;

    if (isBulkAssign) {
      // For bulk assignment, we only care if we're submitting or if there are no selected cases
      return isSubmitting || !(selectedCases && selectedCases.length > 0);
    }

    // For single assignment, use the original logic
    return (
      isSubmitting ||
      selectedUserId === currentAssigneeId ||
      (selectedUserId === null && currentAssigneeId === null)
    );
  };

  // Add effect to handle keyboard event propagation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen) {
        e.stopPropagation();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isBulkAssign
              ? t("common.dialogs.assignBulk.title")
              : t("common.dialogs.assign.title")}
          </DialogTitle>
          <DialogDescription>{getDialogDescription()}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="items-center gap-4">
            <Label className="items-center justify-between whitespace-nowrap">
              <AsyncCombobox
                value={selectedUser}
                onValueChange={setSelectedUser}
                fetchOptions={(query, page, pageSize) =>
                  searchProjectMembers(projectId, query, page, pageSize)
                }
                renderOption={(user) => <UserNameCell userId={user.id} hideLink />}
                getOptionValue={(user) => user.id}
                placeholder={t("sessions.placeholders.selectUser")}
                disabled={isSubmitting}
                className="w-full"
                pageSize={20}
                showTotal={true}
                showUnassigned={true}
              />
            </Label>
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          <div></div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              onClick={handleAssign}
              disabled={isAssignButtonDisabled()}
            >
              {isSubmitting
                ? t("common.actions.saving")
                : t("common.actions.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

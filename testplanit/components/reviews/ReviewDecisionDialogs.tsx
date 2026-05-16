"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

export type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

interface BaseDialogProps {
  reviewRequestId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: ReviewableEntityType;
  targetStateName: string;
  /**
   * Called after a successful decide (HTTP 200) AND after a 409
   * ALREADY_DECIDED (so the parent banner refetches and stops showing
   * the stale PENDING state). Not called on 403 INELIGIBLE_REVIEWER —
   * the dialog stays open so the reviewer can see why.
   */
  onSuccess?: () => void;
}

interface DecideErrorPayload {
  /** Hoisted status from the wire — 403, 409, 4xx, 500. */
  status: number;
  /**
   * Decoded body if the response contained one. Typed loosely because the
   * route returns `{ error: { code, details? } | string }` and we only key
   * on a handful of known codes.
   */
  body: { error?: { code?: string } | string } | undefined;
}

/**
 * Shared POST helper. Caller decides what to do with the structured error
 * payload — the dialog components below uniformly translate
 *   403 INELIGIBLE_REVIEWER → toast + stay open
 *   409 ALREADY_DECIDED     → toast + close + onSuccess (refetch banner)
 *   200                     → toast + close + onSuccess
 *   anything else           → generic error toast + close (avoids stuck
 *                             dialog on unexpected server states)
 */
async function postDecision(
  reviewRequestId: string,
  body: { decision: Decision; comment?: string },
): Promise<{ ok: true } | { ok: false; err: DecideErrorPayload }> {
  let response: Response;
  try {
    response = await fetch(`/api/reviews/${reviewRequestId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      err: { status: 0, body: undefined },
    };
  }

  if (response.ok) {
    return { ok: true };
  }

  let parsedBody: DecideErrorPayload["body"];
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = undefined;
  }
  return {
    ok: false,
    err: { status: response.status, body: parsedBody },
  };
}

function extractErrorCode(err: DecideErrorPayload): string | undefined {
  const errorField = err.body?.error;
  if (errorField && typeof errorField === "object" && "code" in errorField) {
    return errorField.code;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// ApproveDialog (AlertDialog confirm, optional approval note)
// ─────────────────────────────────────────────────────────────────────────────

export function ApproveDialog({
  reviewRequestId,
  open,
  onOpenChange,
  entityType,
  targetStateName,
  onSuccess,
}: BaseDialogProps) {
  const t = useTranslations("reviews.reviewer");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    const trimmed = note.trim();
    const result = await postDecision(reviewRequestId, {
      decision: "APPROVED",
      ...(trimmed.length > 0 ? { comment: trimmed } : {}),
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success(t("approveSuccess"));
      onOpenChange(false);
      setNote("");
      onSuccess?.();
      return;
    }

    const code = extractErrorCode(result.err);
    // WR-01: match on the typed code, not on status alone. A 403 from an
    // unrelated middleware (CSRF, rate-limit, future-feature gate) must
    // NOT render as "you are not eligible to review" — that would mislead
    // the user. The decide route consistently emits
    // `{ error: { code: 'INELIGIBLE_REVIEWER' } }` for the eligibility
    // path; the dialog keys on that code only.
    if (code === "INELIGIBLE_REVIEWER") {
      toast.error(t("ineligibleError"));
      // Dialog stays open — reviewer needs to see the gate.
      return;
    }
    if (code === "ALREADY_DECIDED" || result.err.status === 409) {
      toast.error(t("alreadyDecidedError"));
      onOpenChange(false);
      setNote("");
      onSuccess?.();
      return;
    }
    toast.error(t("decideError"));
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="approve-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("approveConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("approveConfirmDescription", {
              entityType,
              targetStateName,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`approve-note-${reviewRequestId}`}>
            {t("approvalNoteLabel")}
          </Label>
          <Textarea
            id={`approve-note-${reviewRequestId}`}
            data-testid="approve-note-input"
            placeholder={t("approvalNotePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {t("cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            data-testid="approve-confirm"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {t("confirmApprove")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RequestChangesDialog (Dialog with required comment, warning styling)
// ─────────────────────────────────────────────────────────────────────────────

export function RequestChangesDialog({
  reviewRequestId,
  open,
  onOpenChange,
  onSuccess,
}: BaseDialogProps) {
  const t = useTranslations("reviews.reviewer");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = comment.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const result = await postDecision(reviewRequestId, {
      decision: "CHANGES_REQUESTED",
      comment: trimmed,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success(t("requestChangesSuccess"));
      onOpenChange(false);
      setComment("");
      onSuccess?.();
      return;
    }

    const code = extractErrorCode(result.err);
    // WR-01: code-only match — see ApproveDialog for the rationale.
    if (code === "INELIGIBLE_REVIEWER") {
      toast.error(t("ineligibleError"));
      return;
    }
    if (code === "ALREADY_DECIDED" || result.err.status === 409) {
      toast.error(t("alreadyDecidedError"));
      onOpenChange(false);
      setComment("");
      onSuccess?.();
      return;
    }
    toast.error(t("decideError"));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="request-changes-dialog">
        <DialogHeader>
          <DialogTitle>{t("requestChangesTitle")}</DialogTitle>
          <DialogDescription>
            {t("requestChangesDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`request-changes-comment-${reviewRequestId}`}>
            {t("requestChangesCommentLabel")}
          </Label>
          <Textarea
            id={`request-changes-comment-${reviewRequestId}`}
            data-testid="request-changes-comment-input"
            placeholder={t("requestChangesCommentPlaceholder")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            data-testid="request-changes-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-warning text-warning-foreground hover:bg-warning/90"
          >
            {t("confirmRequestChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RejectDialog (AlertDialog with required comment, destructive styling)
// ─────────────────────────────────────────────────────────────────────────────

export function RejectDialog({
  reviewRequestId,
  open,
  onOpenChange,
  entityType,
  targetStateName,
  onSuccess,
}: BaseDialogProps) {
  const t = useTranslations("reviews.reviewer");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = comment.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const result = await postDecision(reviewRequestId, {
      decision: "REJECTED",
      comment: trimmed,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success(t("rejectSuccess"));
      onOpenChange(false);
      setComment("");
      onSuccess?.();
      return;
    }

    const code = extractErrorCode(result.err);
    // WR-01: code-only match — see ApproveDialog for the rationale.
    if (code === "INELIGIBLE_REVIEWER") {
      toast.error(t("ineligibleError"));
      return;
    }
    if (code === "ALREADY_DECIDED" || result.err.status === 409) {
      toast.error(t("alreadyDecidedError"));
      onOpenChange(false);
      setComment("");
      onSuccess?.();
      return;
    }
    toast.error(t("decideError"));
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="reject-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rejectTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("rejectDescription", { entityType, targetStateName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`reject-comment-${reviewRequestId}`}>
            {t("rejectCommentLabel")}
          </Label>
          <Textarea
            id={`reject-comment-${reviewRequestId}`}
            data-testid="reject-comment-input"
            placeholder={t("rejectCommentPlaceholder")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {t("cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            data-testid="reject-confirm"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("confirmReject")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

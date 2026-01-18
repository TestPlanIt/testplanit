"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShareLinkCreated } from "@/components/share/ShareLinkCreated";
import { ShareLinkList } from "@/components/share/ShareLinkList";
import { Calendar as CalendarIcon, Loader2, Info } from "lucide-react";
import { format } from "date-fns";
import { cn } from "~/utils";
import { ShareLinkMode } from "@prisma/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateShareLink } from "~/lib/hooks";
import { prepareShareLinkData, auditShareLinkCreation } from "@/actions/share-links";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number; // Optional for cross-project reports
  reportConfig: any;
  reportTitle?: string;
}

export function ShareDialog({
  open,
  onOpenChange,
  projectId,
  reportConfig,
  reportTitle,
}: ShareDialogProps) {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<"create" | "list">("create");

  // Form state
  const [mode, setMode] = useState<ShareLinkMode>("PUBLIC");
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined);
  const [notifyOnView, setNotifyOnView] = useState(false);
  const [title, setTitle] = useState(reportTitle || "");
  const [description, setDescription] = useState("");

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [createdShare, setCreatedShare] = useState<any>(null);

  // Use ZenStack hook for creating share links
  const { mutateAsync: createShareLink, isPending: isCreating } = useCreateShareLink();

  const handleCreateShare = async () => {
    setError(null);

    try {
      // Validate session
      if (!session?.user?.id) {
        setError("You must be logged in to create a share link");
        return;
      }

      // Validate password for PASSWORD_PROTECTED mode
      if (mode === "PASSWORD_PROTECTED" && !password) {
        setError("Password is required for password-protected shares");
        return;
      }

      if (mode === "PASSWORD_PROTECTED" && password.length < 4) {
        setError("Password must be at least 4 characters");
        return;
      }

      // Prepare share key and password hash via server action
      const { shareKey, passwordHash } = await prepareShareLinkData({
        password: mode === "PASSWORD_PROTECTED" ? password : null,
      });

      // Create share link using ZenStack hook
      const shareLink = await createShareLink({
        data: {
          shareKey,
          entityType: "REPORT",
          entityConfig: reportConfig,
          ...(projectId && {
            project: {
              connect: { id: projectId },
            },
          }),
          createdBy: {
            connect: { id: session?.user?.id },
          },
          mode,
          passwordHash,
          expiresAt: expiresAt || null,
          notifyOnView,
          title: title || null,
          description: description || null,
        },
      });

      if (!shareLink) {
        throw new Error("Failed to create share link");
      }

      // Create audit log via server action
      await auditShareLinkCreation({
        id: shareLink.id,
        shareKey: shareLink.shareKey,
        entityType: shareLink.entityType,
        mode: shareLink.mode,
        title: shareLink.title,
        projectId: shareLink.projectId ?? undefined,
        expiresAt: shareLink.expiresAt,
        notifyOnView: shareLink.notifyOnView,
        passwordHash: shareLink.passwordHash,
      });

      // Generate share URL
      const protocol = window.location.protocol;
      const host = window.location.host;
      const shareUrl = `${protocol}//${host}/share/${shareKey}`;

      // Set created share data for success view
      setCreatedShare({
        ...shareLink,
        shareUrl,
      });

      // Reset form
      setPassword("");
      setExpiresAt(undefined);
      setNotifyOnView(false);
      setDescription("");
    } catch (error) {
      console.error("Error creating share:", error);
      setError(error instanceof Error ? error.message : "An error occurred");
    }
  };

  const handleCloseCreated = () => {
    setCreatedShare(null);
    setActiveTab("list"); // Switch to list tab to see the new share
  };

  const handleCreateAnother = () => {
    setCreatedShare(null);
    // Stay on create tab
  };

  if (createdShare) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <ShareLinkCreated
            shareData={createdShare}
            onClose={handleCloseCreated}
            onCreateAnother={handleCreateAnother}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share Report</DialogTitle>
          <DialogDescription>
            Create a shareable link or manage existing shares for this report.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "create" | "list")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create">Create Share</TabsTrigger>
            <TabsTrigger value="list">My Shares</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-4 mt-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Share Mode */}
            <div className="space-y-3">
              <Label>Share Mode</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as ShareLinkMode)}>
                <div className="flex items-start space-x-2 rounded-lg border p-4">
                  <RadioGroupItem value="PUBLIC" id="public" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="public" className="font-medium cursor-pointer">
                      Public (anyone with link)
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Anyone with the link can view this report without logging in.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-2 rounded-lg border p-4">
                  <RadioGroupItem value="PASSWORD_PROTECTED" id="password" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="password" className="font-medium cursor-pointer">
                      Password Protected
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Anyone with the link and password can view. Logged-in users with project
                      access skip password.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-2 rounded-lg border p-4">
                  <RadioGroupItem value="AUTHENTICATED" id="authenticated" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="authenticated" className="font-medium cursor-pointer">
                      Authenticated (requires login)
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Only logged-in users with access to this project can view.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Password field (conditional) */}
            {mode === "PASSWORD_PROTECTED" && (
              <div className="space-y-2">
                <Label htmlFor="password-input">Password *</Label>
                <Input
                  id="password-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password (min 4 characters)"
                  required
                />
              </div>
            )}

            {/* Expiration date */}
            <div className="space-y-2">
              <Label>Expiration (optional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !expiresAt && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expiresAt ? format(expiresAt, "PPP") : "No expiration"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={expiresAt}
                    onSelect={setExpiresAt}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                  {expiresAt && (
                    <div className="p-3 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpiresAt(undefined)}
                        className="w-full"
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Link will expire at midnight on the selected date
              </p>
            </div>

            {/* Notify on view */}
            <div className="flex items-start space-x-2">
              <Checkbox
                id="notify"
                checked={notifyOnView}
                onCheckedChange={(checked) => setNotifyOnView(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="notify" className="font-medium cursor-pointer">
                  Notify me when someone views this link
                </Label>
                <p className="text-sm text-muted-foreground">
                  You'll receive an in-app notification when the share link is accessed.
                </p>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title (optional)</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Q4 Test Execution Report"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description for this shared report..."
                rows={3}
              />
            </div>

            {/* Info alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {mode === "PUBLIC" && "Anyone with the link can access this report without authentication."}
                {mode === "PASSWORD_PROTECTED" && "Users will need to enter the password to view, unless they're logged in with project access."}
                {mode === "AUTHENTICATED" && "Only users logged in with access to this project can view this report."}
              </AlertDescription>
            </Alert>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateShare} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Share Link"
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="list" className="mt-4">
            <ShareLinkList projectId={projectId} entityType="REPORT" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

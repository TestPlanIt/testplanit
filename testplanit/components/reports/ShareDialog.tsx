"use client";

import { useState, useMemo } from "react";
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
import { Calendar as CalendarIcon, Loader2, Info, Asterisk } from "lucide-react";
import { format } from "date-fns";
import { cn } from "~/utils";
import { ShareLinkMode } from "@prisma/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateShareLink } from "~/lib/hooks";
import { prepareShareLinkData, auditShareLinkCreation } from "@/actions/share-links";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("reports.shareDialog");
  const tCommon = useTranslations("common");
  const tAuth = useTranslations("auth.signup.errors");
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<"create" | "list">("create");

  // Form state
  const [mode, setMode] = useState<ShareLinkMode>("AUTHENTICATED");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined);
  const [notifyOnView, setNotifyOnView] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [createdShare, setCreatedShare] = useState<any>(null);

  // Use ZenStack hook for creating share links
  const { mutateAsync: createShareLink, isPending: isCreating } = useCreateShareLink();

  // Generate default title with timestamp
  const defaultTitle = useMemo(() => {
    return `${reportTitle || "Report"} - ${format(new Date(), "MMM d, yyyy h:mm a")}`;
  }, [reportTitle]);

  const handleCreateShare = async () => {
    setError(null);
    setPasswordError(null);

    try {
      // Validate session
      if (!session?.user?.id) {
        setError(t("errors.loginRequired"));
        return;
      }

      // Validate password for PASSWORD_PROTECTED mode
      if (mode === "PASSWORD_PROTECTED" && (!password || password.length < 4)) {
        setPasswordError(tAuth("passwordRequired"));
        return;
      }

      if (mode === "PASSWORD_PROTECTED" && password !== confirmPassword) {
        setPasswordError(tAuth("passwordsDoNotMatch"));
        return;
      }

      // Prepare share key and password hash via server action
      const { shareKey, passwordHash } = await prepareShareLinkData({
        password: mode === "PASSWORD_PROTECTED" ? password : null,
      });

      // Use provided title or default title with timestamp
      const finalTitle = title || defaultTitle;

      // Create share link using ZenStack hook
      const shareLink = await createShareLink({
        data: {
          shareKey,
          entityType: "REPORT",
          entityConfig: reportConfig,
          ...(projectId !== undefined && { projectId }),
          createdById: session.user.id,
          mode,
          passwordHash,
          expiresAt: expiresAt || null,
          notifyOnView,
          title: finalTitle,
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
        projectId: shareLink.projectId !== null ? shareLink.projectId : undefined,
        expiresAt: shareLink.expiresAt,
        notifyOnView: shareLink.notifyOnView,
        passwordHash: shareLink.passwordHash,
      });

      // Generate share URL (without locale - middleware will redirect based on user preference/browser language)
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
      setConfirmPassword("");
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
        <DialogContent className="max-w-4xl">
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "create" | "list")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create">{t("tabs.create")}</TabsTrigger>
            <TabsTrigger value="list">{t("tabs.list")}</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-4 mt-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Share Mode */}
            <div className="space-y-3">
              <Label>{t("shareMode.label")}</Label>
              <RadioGroup value={mode} onValueChange={(v) => {
                setMode(v as ShareLinkMode);
                setPasswordError(null);
              }}>
                <div className="flex items-start space-x-2 rounded-lg border p-4">
                  <RadioGroupItem value="AUTHENTICATED" id="authenticated" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="authenticated" className="font-medium cursor-pointer">
                      {t("shareMode.authenticated.title")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {projectId
                        ? t("shareMode.authenticated.description")
                        : t("shareMode.authenticated.descriptionCrossProject")}
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-2 rounded-lg border p-4">
                  <RadioGroupItem value="PASSWORD_PROTECTED" id="password" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="password" className="font-medium cursor-pointer">
                      {t("shareMode.passwordProtected.title")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {projectId
                        ? t("shareMode.passwordProtected.description")
                        : t("shareMode.passwordProtected.descriptionCrossProject")}
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-2 rounded-lg border p-4">
                  <RadioGroupItem value="PUBLIC" id="public" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="public" className="font-medium cursor-pointer">
                      {t("shareMode.public.title")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("shareMode.public.description")}
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Password field (conditional) */}
            {mode === "PASSWORD_PROTECTED" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password-input" className="flex items-center">
                    {tCommon("fields.password")}
                    <sup>
                      <Asterisk className="w-3 h-3 text-destructive" />
                    </sup>
                  </Label>
                  <Input
                    id="password-input"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    placeholder="••••••••"
                    required
                    className={passwordError ? "border-destructive" : ""}
                  />
                  {passwordError && (
                    <p className="text-sm text-destructive">{passwordError}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password-input" className="flex items-center">
                    {tCommon("fields.confirmPassword")}
                    <sup>
                      <Asterisk className="w-3 h-3 text-destructive" />
                    </sup>
                  </Label>
                  <Input
                    id="confirm-password-input"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    placeholder="••••••••"
                    required
                    className={passwordError ? "border-destructive" : ""}
                  />
                </div>
              </div>
            )}

            {/* Expiration date */}
            <div className="space-y-2">
              <Label>{t("expiration.label")}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !expiresAt && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="h-4 w-4" />
                    {expiresAt ? format(expiresAt, "PPP") : t("expiration.noExpiration")}
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
                        {t("expiration.clear")}
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                {t("expiration.expiresAtMidnight")}
              </p>
            </div>

            {/* Notify on view */}
            <div className="flex items-start space-x-2">
              <Checkbox
                id="notify"
                checked={notifyOnView}
                onCheckedChange={(checked) => setNotifyOnView(checked === true)}
              />
              <div className="-mt-1">
                <Label htmlFor="notify" className="font-medium cursor-pointer">
                  {t("notifyOnView.label")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("notifyOnView.description")}
                </p>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">{t("title.label")}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={defaultTitle}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use: {defaultTitle}
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">{t("description.label")}</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("description.placeholder")}
                rows={3}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={handleCreateShare} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("actions.creating")}
                  </>
                ) : (
                  t("actions.createShareLink")
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

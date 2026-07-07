import { LinkFavicon } from "@/components/LinkFavicon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { filesize } from "filesize";
import {
  CloudUpload,
  FileStack,
  FileText,
  Link as LinkIcon,
  Loader2,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import React, { useEffect, useId, useRef, useState } from "react";

/**
 * Shape staged by the inline "Add Link" affordance and surfaced to parents
 * via `onLinksChange`. Mirrors the persisted Attachments row enough that
 * parents can drop it straight into their attachments payload alongside
 * uploaded files. `mimeType: "text/uri-list"` is the existing in-codebase
 * discriminator (see Testmo importer, AttachmentsDisplay, AttachmentPreview).
 */
export interface LinkAttachmentInput {
  url: string;
  name: string;
  note?: string;
  mimeType: "text/uri-list";
  size: number;
}

interface UploadAttachmentsProps {
  onFileSelect: (files: File[]) => void;
  compact?: boolean;
  disabled?: boolean;
  previews?: boolean;
  accept?: string;
  allowedTypes?: string[];
  initialFiles?: File[];
  multiple?: boolean;
  /**
   * Opt in to the "Add Link" affordance. When true, the upload UI renders a
   * second button that expands an inline URL form. Defaults to false so the
   * import wizards (file-only by purpose) don't pick it up accidentally.
   */
  allowLinks?: boolean;
  /** Notified whenever the user adds or removes a staged link. */
  onLinksChange?: (links: LinkAttachmentInput[]) => void;
  /** Mirrors `initialFiles`: seed the staged-links list once on mount. */
  initialLinks?: LinkAttachmentInput[];
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function UploadAttachments({
  onFileSelect,
  compact = false,
  disabled = false,
  previews = true,
  accept,
  allowedTypes,
  initialFiles,
  multiple = true,
  allowLinks = false,
  onLinksChange,
  initialLinks,
}: UploadAttachmentsProps) {
  const t = useTranslations("common.upload.attachments");
  const tLink = useTranslations("common.upload.attachments.link");
  const tGlobal = useTranslations();

  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Link-mode state — only meaningful when `allowLinks` is true.
  const [selectedLinks, setSelectedLinks] = useState<LinkAttachmentInput[]>([]);
  const [isLinkFormOpen, setIsLinkFormOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  // Seed selectedFiles from initialFiles prop when it changes from empty to non-empty
  const initialFilesAppliedRef = useRef(false);
  useEffect(() => {
    if (
      initialFiles &&
      initialFiles.length > 0 &&
      !initialFilesAppliedRef.current
    ) {
      initialFilesAppliedRef.current = true;
      setSelectedFiles(initialFiles);
    }
    // Reset the ref when initialFiles becomes empty so it can be re-applied
    if (!initialFiles || initialFiles.length === 0) {
      initialFilesAppliedRef.current = false;
    }
  }, [initialFiles]);

  // Mirror initialFiles' one-shot seed behavior for staged links.
  const initialLinksAppliedRef = useRef(false);
  useEffect(() => {
    if (
      initialLinks &&
      initialLinks.length > 0 &&
      !initialLinksAppliedRef.current
    ) {
      initialLinksAppliedRef.current = true;
      setSelectedLinks(initialLinks);
    }
    if (!initialLinks || initialLinks.length === 0) {
      initialLinksAppliedRef.current = false;
    }
  }, [initialLinks]);

  // Generate unique IDs for file inputs to prevent conflicts when multiple instances exist
  const uniqueId = useId();
  const fileInputId = compact
    ? `compact-file-upload-${uniqueId}`
    : `file-upload-${uniqueId}`;

  const validateFileType = (file: File): boolean => {
    if (!allowedTypes || allowedTypes.length === 0) {
      return true;
    }

    return allowedTypes.some((type) => {
      if (type.startsWith(".")) {
        return file.name.toLowerCase().endsWith(type.toLowerCase());
      }
      return file.type === type;
    });
  };

  const handleFileRead = (file: File) => {
    if (!validateFileType(file)) {
      setErrorMessage(
        t("invalidFileType", { types: allowedTypes?.join(", ") || "" })
      );
      return;
    }

    setErrorMessage(null);
    setUploading(true);
    setSelectedFiles((prevFiles) => {
      // In single-file mode, replace instead of append
      if (!multiple) {
        return [file];
      }
      // Check if file with same name and size already exists to prevent duplicates
      const isDuplicate = prevFiles.some(
        (f) =>
          f.name === file.name &&
          f.size === file.size &&
          f.lastModified === file.lastModified
      );
      if (isDuplicate) {
        setUploading(false);
        setIsDragging(false);
        return prevFiles;
      }
      const updatedFiles = [...prevFiles, file];
      return updatedFiles;
    });
    setUploading(false);
    setIsDragging(false);
  };

  // Notify parent when selectedFiles changes
  // Using a ref to track the previous value to avoid unnecessary calls
  // Track if we've ever had files to avoid notifying with empty array on mount/remount
  const prevSelectedFilesRef = React.useRef<File[]>([]);
  const hasEverHadFilesRef = React.useRef(false);
  useEffect(() => {
    // Track if we've ever had files
    if (selectedFiles.length > 0) {
      hasEverHadFilesRef.current = true;
    }

    // Skip notifying parent with empty files unless we previously had files
    // This prevents resetting parent state on mount/remount
    if (selectedFiles.length === 0 && !hasEverHadFilesRef.current) {
      return;
    }

    // Only call onFileSelect if the files array actually changed
    if (prevSelectedFilesRef.current !== selectedFiles) {
      prevSelectedFilesRef.current = selectedFiles;
      onFileSelect(selectedFiles);
    }
  }, [selectedFiles, onFileSelect]);

  // Mirror the mount-suppress + change-detect pattern used for files so we
  // don't fire a spurious empty-array notification on mount/remount.
  const prevSelectedLinksRef = React.useRef<LinkAttachmentInput[]>([]);
  const hasEverHadLinksRef = React.useRef(false);
  useEffect(() => {
    if (!onLinksChange) return;
    if (selectedLinks.length > 0) hasEverHadLinksRef.current = true;
    if (selectedLinks.length === 0 && !hasEverHadLinksRef.current) return;
    if (prevSelectedLinksRef.current !== selectedLinks) {
      prevSelectedLinksRef.current = selectedLinks;
      onLinksChange(selectedLinks);
    }
  }, [selectedLinks, onLinksChange]);

  const resetLinkForm = () => {
    setLinkUrl("");
    setLinkName("");
    setLinkNote("");
    setLinkError(null);
    setIsLinkFormOpen(false);
  };

  const handleAddLink = () => {
    const trimmedUrl = linkUrl.trim();
    if (!isValidHttpUrl(trimmedUrl)) {
      setLinkError(tLink("invalidUrl"));
      return;
    }
    const link: LinkAttachmentInput = {
      url: trimmedUrl,
      name: linkName.trim() || trimmedUrl,
      note: linkNote.trim() || undefined,
      mimeType: "text/uri-list",
      // Size convention: store the URL's character length so the row is
      // never zero-sized (matches what the Testmo importer writes).
      size: trimmedUrl.length,
    };
    setSelectedLinks((prev) => {
      // De-dupe by URL — pasting the same link twice shouldn't multiply rows.
      const isDuplicate = prev.some((l) => l.url === link.url);
      if (isDuplicate) return prev;
      return multiple ? [...prev, link] : [link];
    });
    resetLinkForm();
  };

  const removeLink = (index: number) => {
    setSelectedLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    Array.from(files).forEach(handleFileRead);
    // Reset input value to allow selecting the same file again if needed
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = event.dataTransfer.files;
    if (files.length) {
      Array.from(files).forEach(handleFileRead);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prevFiles) => {
      return prevFiles.filter((_, i) => i !== index);
    });
  };

  const getThumbnail = (file: File) => {
    const fileURL = URL.createObjectURL(file);

    if (file.type.startsWith("image/")) {
      return (
        <Image
          src={fileURL}
          alt={file.name}
          className="w-full h-full object-cover rounded-full"
          fill
        />
      );
    } else if (file.type === "application/pdf") {
      return (
        <iframe
          src={fileURL}
          className="w-full h-full rounded-lg"
          title={file.name}
        />
      );
    } else if (file.type.startsWith("text/")) {
      return (
        <pre className="w-full h-full overflow-auto rounded-lg p-2 bg-accent">
          {file.name}
        </pre>
      );
    } else if (file.type.startsWith("video/")) {
      return (
        <video src={fileURL} controls className="w-full h-full rounded-lg" />
      );
    } else if (file.type.startsWith("audio/")) {
      return (
        <audio src={fileURL} controls className="w-full h-full rounded-lg" />
      );
    } else {
      return <CloudUpload className="m-3 w-full h-full text-primary" />;
    }
  };

  const _truncateFileName = (fileName: string, maxLength = 24) => {
    if (fileName.length <= maxLength) {
      return fileName;
    }

    const lastDotIndex = fileName.lastIndexOf(".");
    const hasExtension = lastDotIndex > 0 && lastDotIndex < fileName.length - 1;

    if (!hasExtension) {
      return `${fileName.slice(0, Math.max(1, maxLength - 3))}...`;
    }

    const extension = fileName.slice(lastDotIndex);
    const baseMaxLength = Math.max(1, maxLength - extension.length - 3);
    const baseName = fileName.slice(0, baseMaxLength);

    return `${baseName}...${extension}`;
  };

  const _isImageFile = (file: File) => file.type.startsWith("image/");

  // ─── Link-mode render helpers ──────────────────────────────────────────────
  // Kept here (vs. a separate component) so the link state lives next to the
  // file state and the two surfaces share the same `disabled` / `multiple`
  // semantics without prop drilling.

  const showLinkAffordance = allowLinks && !uploading;
  const linkUrlIsValid = isValidHttpUrl(linkUrl.trim());

  const renderLinkForm = () => (
    <div className="w-full space-y-2 rounded-md border border-dashed border-muted p-3">
      <div className="space-y-1">
        <Label htmlFor={`${fileInputId}-link-url`} className="text-xs">
          {tLink("urlLabel")}
        </Label>
        <Input
          id={`${fileInputId}-link-url`}
          type="url"
          autoFocus
          inputMode="url"
          placeholder={tLink("urlPlaceholder")}
          value={linkUrl}
          onChange={(e) => {
            setLinkUrl(e.target.value);
            if (linkError) setLinkError(null);
          }}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fileInputId}-link-name`} className="text-xs">
          {tLink("nameLabel")}
        </Label>
        <Input
          id={`${fileInputId}-link-name`}
          type="text"
          placeholder={tLink("namePlaceholder")}
          value={linkName}
          onChange={(e) => setLinkName(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fileInputId}-link-note`} className="text-xs">
          {tLink("noteLabel")}
        </Label>
        <Textarea
          id={`${fileInputId}-link-note`}
          rows={2}
          placeholder={tLink("notePlaceholder")}
          value={linkNote}
          onChange={(e) => setLinkNote(e.target.value)}
          disabled={disabled}
        />
      </div>
      {linkError && <div className="text-destructive text-xs">{linkError}</div>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetLinkForm}
          disabled={disabled}
        >
          {tGlobal("common.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleAddLink}
          disabled={disabled || !linkUrlIsValid}
        >
          {tLink("addButton")}
        </Button>
      </div>
    </div>
  );

  const renderAddLinkButton = (size: "sm" | "default") => (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={() => {
        setIsLinkFormOpen(true);
        setLinkError(null);
      }}
      disabled={disabled}
    >
      <LinkIcon className={size === "sm" ? "w-4 h-4" : "w-5 h-5"} />
      {tLink("addButton")}
    </Button>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-1">
        <div
          className={`items-center justify-center border-2 ${
            isDragging && !disabled
              ? "bg-accent dark:bg-primary"
              : "border-dashed border-muted"
          } rounded-lg p-2 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          onDragOver={disabled ? undefined : handleDragOver}
          onDragLeave={disabled ? undefined : handleDragLeave}
          onDrop={disabled ? undefined : handleDrop}
        >
          {uploading && (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          )}
          {errorMessage && (
            <div className="text-destructive text-xs">{errorMessage}</div>
          )}
          <input
            type="file"
            multiple={multiple}
            accept={accept}
            onChange={handleFileChange}
            disabled={uploading || disabled}
            style={{ display: "none" }}
            id={fileInputId}
          />
          <div className="flex items-center w-full gap-2">
            <label
              htmlFor={fileInputId}
              className={`flex items-center flex-1 min-w-0 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
            >
              <CloudUpload className="w-5 h-5 me-1" />
              <span className="text-sm truncate inline-block">
                {uploading
                  ? tGlobal("common.status.uploading")
                  : selectedFiles.length > 0
                    ? multiple
                      ? tGlobal("common.upload.attachments.addMoreFiles")
                      : tGlobal("common.upload.attachments.replaceFile")
                    : tGlobal(
                        multiple
                          ? "common.upload.attachments.selectFiles"
                          : "common.upload.attachments.selectFile",
                        { count: selectedFiles.length }
                      )}
              </span>
              {selectedFiles.length > 1 && (
                <span className="ms-auto flex items-center gap-0.5 text-sm text-muted-foreground">
                  <FileStack className="w-4 h-4" />
                  {String(
                    filesize(selectedFiles.reduce((sum, f) => sum + f.size, 0))
                  )}
                </span>
              )}
            </label>
            {showLinkAffordance && !isLinkFormOpen && renderAddLinkButton("sm")}
          </div>
        </div>
        {showLinkAffordance && isLinkFormOpen && renderLinkForm()}
        {(selectedFiles.length > 0 || selectedLinks.length > 0) && (
          <ul className="flex flex-col gap-0.5">
            {selectedFiles.map((file, index) => (
              <li
                key={`file-${index}`}
                className="flex items-center justify-between gap-1 text-sm px-1 py-0.5 rounded hover:bg-accent"
              >
                <span className="flex items-center gap-1 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate text-muted-foreground">
                    {file.name}
                  </span>
                </span>
                <span className="flex items-center">
                  <span className="text-xs text-muted-foreground pe-2">
                    {filesize(file.size)}
                  </span>
                  {!disabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(index)}
                      aria-label={tGlobal("common.actions.remove")}
                      className="shrink-0 h-6 w-6 p-0.5 text-foreground/70 hover:text-destructive"
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
            {selectedLinks.map((link, index) => (
              <li
                key={`link-${index}`}
                className="flex items-center justify-between gap-1 text-sm px-1 py-0.5 rounded hover:bg-accent"
                title={link.url}
              >
                <span className="flex items-center gap-1 min-w-0">
                  <LinkFavicon url={link.url} className="w-4 h-4" />
                  <span className="truncate text-muted-foreground">
                    {link.name}
                  </span>
                </span>
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLink(index)}
                    aria-label={tGlobal("common.actions.remove")}
                    className="shrink-0 h-6 w-6 p-0.5 text-foreground/70 hover:text-destructive"
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <Card
      className={`min-w-min ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent
        className={`flex flex-col items-center justify-center border-2 ${
          isDragging && !disabled
            ? "bg-accent dark:bg-primary"
            : "border-dashed border-muted"
        } rounded-lg p-4 space-y-2`}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragLeave={disabled ? undefined : handleDragLeave}
        onDrop={disabled ? undefined : handleDrop}
      >
        {uploading && (
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        )}
        {errorMessage && <div className="text-destructive">{errorMessage}</div>}
        <input
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={handleFileChange}
          disabled={uploading || disabled}
          style={{ display: "none" }}
          id={fileInputId}
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label
            htmlFor={fileInputId}
            className={`${disabled ? "pointer-events-none cursor-not-allowed" : "cursor-pointer"}`}
          >
            <Button
              type="button"
              variant="outline"
              disabled={uploading || disabled}
              asChild
            >
              <span>
                <CloudUpload className="w-5 h-5" />
                {uploading
                  ? tGlobal("common.status.uploading")
                  : tGlobal(
                      multiple
                        ? "common.upload.attachments.selectFiles"
                        : "common.upload.attachments.selectFile",
                      { count: selectedFiles.length }
                    )}
              </span>
            </Button>
          </label>
          {showLinkAffordance &&
            !isLinkFormOpen &&
            renderAddLinkButton("default")}
        </div>
        {showLinkAffordance && isLinkFormOpen && (
          <div className="w-full max-w-md">{renderLinkForm()}</div>
        )}
        {previews !== false ? (
          <ScrollArea className="w-full max-h-60">
            <div className="flex flex-wrap justify-between">
              {selectedFiles.map((file, index) => (
                <div
                  key={`file-${index}`}
                  className="relative flex flex-col items-center m-2"
                >
                  <div className="mt-2 relative w-16 h-16 bg-accent rounded-full flex items-center justify-center">
                    {getThumbnail(file)}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeFile(index)}
                          aria-label={tGlobal("common.cancel")}
                          className="absolute top-0 start-14 -translate-y-2 -translate-x-2 rtl:translate-x-2 h-7 w-7 rounded-full p-0.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <XCircle className="w-5 h-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {tGlobal("common.cancel")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="w-[100px] lg:w-[150px]">
                    <div className="mb-2 mx-4 text-sm truncate text-center">
                      {file.name}
                    </div>
                  </div>
                </div>
              ))}
              {selectedLinks.map((link, index) => (
                <div
                  key={`link-${index}`}
                  className="relative flex flex-col items-center m-2"
                  title={link.url}
                >
                  <div className="mt-2 relative w-16 h-16 bg-accent rounded-full flex items-center justify-center">
                    <LinkFavicon url={link.url} className="w-8 h-8" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeLink(index)}
                          aria-label={tGlobal("common.cancel")}
                          className="absolute top-0 start-14 -translate-y-2 -translate-x-2 rtl:translate-x-2 h-7 w-7 rounded-full p-0.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <XCircle className="w-5 h-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {tGlobal("common.cancel")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="w-[100px] lg:w-[150px]">
                    <div className="mb-2 mx-4 text-sm truncate text-center">
                      {link.name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea className="max-h-48 h-48 w-full">
            <ul className="flex flex-col gap-1">
              {selectedFiles.map((file, index) => (
                <li
                  key={`file-${index}`}
                  className="flex items-center justify-between gap-0.5 hover:bg-accent p-2"
                >
                  <span className="flex items-center gap-1 truncate max-w-xs">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    {file.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(index)}
                    aria-label={tGlobal("common.cancel")}
                    className="shrink-0 h-7 w-7 p-0.5 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="w-5 h-5" />
                  </Button>
                </li>
              ))}
              {selectedLinks.map((link, index) => (
                <li
                  key={`link-${index}`}
                  className="flex items-center justify-between gap-0.5 hover:bg-accent p-2"
                  title={link.url}
                >
                  <span className="flex items-center gap-1 truncate max-w-xs">
                    <LinkFavicon url={link.url} className="w-4 h-4" />
                    {link.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLink(index)}
                    aria-label={tGlobal("common.cancel")}
                    className="shrink-0 h-7 w-7 p-0.5 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="w-5 h-5" />
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

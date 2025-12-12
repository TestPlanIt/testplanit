import React, { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CloudUpload, Loader2, Plus, XCircle } from "lucide-react";
import Image from "next/image";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UploadAttachmentsProps {
  onFileSelect: (files: File[]) => void;
  compact?: boolean;
  disabled?: boolean;
  previews?: boolean;
  accept?: string;
  allowedTypes?: string[];
}

function ImagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!url) {
    return (
      <div className="w-8 h-8 bg-accent rounded-full" aria-hidden="true" />
    );
  }

  return (
    <div className="w-8 h-8 bg-accent rounded-full overflow-hidden flex items-center justify-center">
      <Image
        src={url}
        alt={file.name}
        className="w-full h-full object-cover"
        width={32}
        height={32}
      />
    </div>
  );
}

export default function UploadAttachments({
  onFileSelect,
  compact = false,
  disabled = false,
  previews = true,
  accept,
  allowedTypes,
}: UploadAttachmentsProps) {
  const t = useTranslations("common.upload.attachments");
  const tBreadcrumb = useTranslations("common.ui.breadcrumb");
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Generate unique IDs for file inputs to prevent conflicts when multiple instances exist
  const uniqueId = useId();
  const fileInputId = compact ? `compact-file-upload-${uniqueId}` : `file-upload-${uniqueId}`;

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
      // Check if file with same name and size already exists to prevent duplicates
      const isDuplicate = prevFiles.some(
        (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
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
      const updatedFiles = prevFiles.filter((_, i) => i !== index);
      onFileSelect(updatedFiles);
      return updatedFiles;
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

  const truncateFileName = (fileName: string, maxLength = 24) => {
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

  const isImageFile = (file: File) => file.type.startsWith("image/");

  if (compact) {
    return (
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
        {uploading && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
        {errorMessage && (
          <div className="text-destructive text-xs">{errorMessage}</div>
        )}
        <input
          type="file"
          multiple
          accept={accept}
          onChange={handleFileChange}
          disabled={uploading || disabled}
          style={{ display: "none" }}
          id={fileInputId}
        />
        <label
          htmlFor={fileInputId}
          className={`flex items-center w-full ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        >
          <CloudUpload className="w-5 h-5 text-primary mr-1" />
          <span className="text-sm truncate inline-block">
            {uploading
              ? t("uploading")
              : selectedFiles.length > 0
              ? truncateFileName(selectedFiles[selectedFiles.length - 1].name)
              : t("selectFiles", { count: selectedFiles.length })}
          </span>
        </label>
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
          multiple
          accept={accept}
          onChange={handleFileChange}
          disabled={uploading || disabled}
          style={{ display: "none" }}
          id={fileInputId}
        />
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
              <CloudUpload className="w-5 h-5 text-primary" />
              {uploading
                ? t("uploading")
                : t("selectFiles", { count: selectedFiles.length })}
            </span>
          </Button>
        </label>
        {previews !== false ? (
          <ScrollArea className="w-full max-h-60">
            <div className="flex flex-wrap justify-between">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="relative flex flex-col items-center m-2"
                >
                  <div className="mt-2 relative w-16 h-16 bg-accent rounded-full flex items-center justify-center">
                    {getThumbnail(file)}
                    <button
                      type="button"
                      className="absolute top-0 left-14 transform -translate-y-2 -translate-x-2"
                      onClick={() => removeFile(index)}
                    >
                      <XCircle className="w-6 h-6 text-destructive" />
                      {t("cancel")}
                    </button>
                  </div>
                  <div className="w-[100px] lg:w-[150px]">
                    <div className="mb-2 mx-4 text-sm truncate text-center">
                      {file.name}
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
                  key={index}
                  className="flex items-center justify-between gap-0.5 hover:bg-accent p-2"
                >
                  <span className="truncate max-w-xs">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    aria-label={t("cancel")}
                  >
                    <XCircle className="w-5 h-5 text-destructive" />
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

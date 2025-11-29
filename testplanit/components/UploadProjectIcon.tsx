import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import Image from "next/image";

interface UploadProjectIconProps {
  onUpload: (url: string) => void;
  initialUrl?: string;
}

const MAX_SIZE = 4 * 1024 * 1024; // 4MB
const ENDPOINT = "/api/get-project-icon-url";

export default function UploadProjectIcon({
  onUpload,
  initialUrl,
}: UploadProjectIconProps) {
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialUrl || null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const t = useTranslations("projects.icon");
  const tCommon = useTranslations("common");

  const handleFileRead = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMessage(t("upload.errors.invalidFileType"));
      return;
    }
    if (file.size > MAX_SIZE) {
      setErrorMessage(t("upload.errors.fileTooLarge", { size: "4MB" }));
      return;
    }
    try {
      setUploading(true);
      // Use a generic 'project' prefix for the upload path
      const prependString = "project";
      const fileUrl = await fetchSignedUrl(
        file,
        ENDPOINT,
        prependString,
        true,
        MAX_SIZE
      );
      onUpload(fileUrl);
      setPreviewUrl(fileUrl);
      setErrorMessage(null);
    } catch (error) {
      console.error("Error uploading file:", error);
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(tCommon("errors.unknown"));
      }
    } finally {
      setUploading(false);
      setIsDragging(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    handleFileRead(files[0]);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = event.dataTransfer.files;
    if (files.length) {
      handleFileRead(files[0]);
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

  return (
    <Card shadow="none">
      <CardHeader className="pb-0">
        <CardTitle>{t("upload.title")}</CardTitle>
        <CardDescription>{t("upload.description")}</CardDescription>
      </CardHeader>
      <CardContent
        className={`flex flex-col items-center justify-center border-2 ${
          isDragging ? " bg-accent" : "border-dashed border-primary/40"
        } rounded-lg space-y-6 m-6`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {errorMessage && <div className="text-destructive">{errorMessage}</div>}
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={uploading}
          style={{ display: "none" }}
          id="project-icon-upload"
        />
        <label
          htmlFor="project-icon-upload"
          className="flex flex-col items-center justify-center space-y-2 cursor-pointer"
        >
          {previewUrl ? (
            <Image
              src={previewUrl}
              alt="Project Icon Preview"
              width={64}
              height={64}
              className="w-16 h-16 rounded"
            />
          ) : (
            <UploadCloudIcon className="w-16 h-16 text-primary" />
          )}
          <Button
            variant="outline"
            type="button"
            disabled={uploading}
            onClick={() =>
              document.getElementById("project-icon-upload")?.click()
            }
          >
            {uploading
              ? tCommon("status.uploading")
              : tCommon("actions.selectFile")}
          </Button>
        </label>
      </CardContent>
    </Card>
  );
}

function UploadCloudIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M12 12v9" />
      <path d="m16 16-4-4-4 4" />
    </svg>
  );
}

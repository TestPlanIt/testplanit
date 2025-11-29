import { useState, useEffect } from "react";
import Image from "next/image";
import { Attachments } from "@prisma/client";
import { File } from "lucide-react";
import { Link } from "~/lib/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";
import { getStorageUrlClient } from "~/utils/storageUrl";

interface AttachmentPreviewProps {
  attachment: Attachments;
  size?: "small" | "medium" | "large";
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachment,
  size = "small",
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [textContent, setTextContent] = useState<string | null>(null);
  // Convert MinIO URLs to proxy URLs for trial instances
  const fileURL = getStorageUrlClient(attachment.url) || attachment.url;
  const fileType = attachment.mimeType;

  useEffect(() => {
    if (fileType.startsWith("image/")) {
      const img = new window.Image();
      img.src = fileURL;
      img.onload = () => {
        setIsLoading(false);
      };
      img.onerror = () => {
        setIsLoading(false);
      };
    } else if (fileType.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = fileURL;
      video.onloadeddata = () => {
        setIsLoading(false);
      };
      video.onerror = () => {
        setIsLoading(false);
      };
    } else if (fileType.startsWith("text/uri")) {
      setIsLoading(false);
    } else if (fileType.startsWith("text/")) {
      fetch(fileURL)
        .then((response) => response.text())
        .then((text) => {
          setTextContent(text);
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, [fileURL, fileType]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-24 w-24">
        <LoadingSpinner />
      </div>
    );
  }

  const getSizeClasses = (baseSize: number) => {
    const sizeMap = {
      small: baseSize,
      medium: baseSize * 2,
      large: baseSize * 3,
    };

    return {
      height: sizeMap[size],
      width: sizeMap[size],
    };
  };

  if (fileType.startsWith("image/")) {
    const { height, width } = getSizeClasses(100);
    return (
      <div
        className="flex justify-center items-center max-h-[350px]"
        style={{ height, width }}
      >
        <Image
          src={fileURL}
          alt={attachment.name}
          height={height}
          width={width}
          className="object-contain"
        />
      </div>
    );
  } else if (fileType === "application/pdf") {
    const { height } = getSizeClasses(32);
    return (
      <iframe
        src={fileURL}
        className={`w-full h-full rounded-lg`}
        title={attachment.name}
      />
    );
  } else if (fileType.startsWith("text/uri")) {
    return (
      <Link href={fileURL} target="_blank">
        {attachment.name}
      </Link>
    );
  } else if (fileType.startsWith("text/")) {
    const { height, width } = getSizeClasses(250);
    return (
      <pre
        className={`w-fit border-2 border-primary/50 rounded-lg p-2 max-h-[650px] max-w-[${width}px] overflow-auto`}
      >
        {textContent || attachment.name}
      </pre>
    );
  } else if (fileType.startsWith("video/")) {
    const { height } = getSizeClasses(32);
    return (
      <video
        src={fileURL}
        controls
        className={`w-full h-${height} max-h-full rounded-lg`}
      />
    );
  } else if (fileType.startsWith("audio/")) {
    const { width } = getSizeClasses(200);
    return (
      <audio
        src={fileURL}
        controls
        className={`min-h-[50px] w-${width} rounded-lg`}
      />
    );
  } else {
    const { height, width } = getSizeClasses(100);
    return (
      <div
        className="flex flex-col items-center overflow-hidden max-h-fit"
        style={{
          width: `${width}px`,
        }}
      >
        <File className={`m-3 w-full h-fit text-primary`} />
        <span className="text-center truncate">{attachment.name}</span>
      </div>
    );
  }
};

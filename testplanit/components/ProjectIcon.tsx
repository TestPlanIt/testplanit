import React from "react";
import Image from "next/image";
import { BoxesIcon } from "lucide-react";
import { getStorageUrlClient } from "~/utils/storageUrl";

interface ProjectIconProps {
  iconUrl?: string | null;
  width?: number;
  height?: number;
}

export const ProjectIcon: React.FC<ProjectIconProps> = ({
  iconUrl,
  width = 20,
  height = 20,
}) => {
  if (!iconUrl) {
    return <BoxesIcon style={{ width, height }} className="shrink-0" />;
  }

  // Convert MinIO URLs to proxy URLs for trial instances
  const proxyUrl = getStorageUrlClient(iconUrl);

  return (
    <Image
      src={proxyUrl || iconUrl}
      alt="Project Icon"
      height={height}
      width={width}
      unoptimized={true}
    />
  );
};

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Image from "next/image";
import React, { useEffect, useState } from "react";
import {
  stringToColorCode,
  textColorClassFor,
} from "~/utils/stringToColorCode";

interface AvatarProps {
  image: string | null;
  alt?: string;
  prependText?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down";
  backgroundColor?: string;
  showTooltip?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({
  image = "",
  alt = "",
  prependText,
  width = 100,
  height = 100,
  fill = false,
  objectFit = "cover",
  backgroundColor,
  showTooltip = true,
}) => {
  const [dynamicFontSize, setDynamicFontSize] = useState<string>("36px");

  useEffect(() => {
    if (width && height) {
      const averageSize = (width + height) / 2;
      const calculatedFontSize = Math.max(12, averageSize / 8).toFixed(0);
      setDynamicFontSize(`${calculatedFontSize}px`);
    }
  }, [width, height]);

  // `textColor` is applied with className below, so both branches have to yield
  // a class. The caller-supplied branch used to hand back "#000", which is not a
  // class name at all — the initials silently inherited whatever colour the
  // surrounding text had, whatever colour the caller painted behind them.
  const { colorCode, textColor } = backgroundColor
    ? {
        colorCode: backgroundColor,
        textColor: textColorClassFor(backgroundColor),
      }
    : stringToColorCode(alt);

  const renderContent = () =>
    image ? (
      <div
        style={{
          width: width,
          height: height,
          position: fill ? "relative" : "static",
          borderRadius: "50%",
          overflow: "hidden",
        }}
      >
        <Image
          unoptimized
          priority
          src={image}
          alt={alt}
          fill={fill}
          width={fill ? undefined : width}
          height={fill ? undefined : height}
          sizes="10vw"
          style={{
            objectFit: objectFit,
          }}
          className="rounded-full"
        />
      </div>
    ) : (
      <div
        className={textColor}
        // Marks the generated initials tile for the a11y scan. This is the one
        // surface whose contrast depends on the name hash rather than on a
        // theme token, so it is worth being able to select on — but it is no
        // longer excluded from the colour gate: the foreground is derived with
        // the WCAG formula, so the pair never falls below 4.58:1.
        data-avatar-initials="true"
        style={{
          width,
          height,
          backgroundColor: colorCode,
          padding: "10px",
          textAlign: "center",
          overflow: "hidden",
          fontSize: dynamicFontSize,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          borderRadius: "50%",
        }}
      >
        {displayText}
      </div>
    );

  const abbreviateAltText = (altText: string): string => {
    let result = altText.charAt(0);
    const firstSpaceIndex = altText.indexOf(" ");
    if (firstSpaceIndex > -1 && firstSpaceIndex < altText.length - 1) {
      result += altText.charAt(firstSpaceIndex + 1);
    }
    return result.toUpperCase();
  };

  const displayText = width && width < 50 ? abbreviateAltText(alt) : alt;

  return showTooltip ? (
    <Tooltip>
      {/* asChild: the avatar (img alt / initials) is the trigger, so we don't
          render a nameless <button type="button"> that also nests inside link/row cells. */}
      <TooltipTrigger asChild>{renderContent()}</TooltipTrigger>
      <TooltipContent>
        <div>{prependText ? `${prependText}: ${alt}` : alt}</div>
      </TooltipContent>
    </Tooltip>
  ) : (
    renderContent()
  );
};

export { Avatar };

/**
 * Utility functions for color handling and manipulation
 */

/**
 * Convert a hex color code to RGB components
 * @param hex The hex color code (with or without #)
 * @returns Object with r, g, b components or null if invalid
 */
export const hexToRgb = (
  hex: string
): { r: number; g: number; b: number } | null => {
  // Default to a light blue if no color is provided
  if (!hex) {
    return { r: 59, g: 130, b: 246 }; // Default blue color
  }

  // Remove the # if it exists
  hex = hex.replace("#", "");

  // Handle both 3-digit and 6-digit hex codes
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  // Ensure the final hex string is exactly 6 characters long
  if (hex.length !== 6) {
    return null;
  }

  // Parse the hex values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return null;
  }

  return { r, g, b };
};

/**
 * Generate a background style object with the specified opacity
 * @param hexColor The hex color code
 * @param opacity The opacity value (0-1)
 * @returns A style object with backgroundColor
 */
export const getBackgroundStyle = (
  hexColor: string,
  opacity: number = 0.1
): React.CSSProperties => {
  const rgb = hexToRgb(hexColor);
  if (rgb) {
    return {
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`,
    };
  }
  return { backgroundColor: "rgba(59, 130, 246, 0.1)" }; // Default blue with 10% opacity
};

/**
 * Generate a text color style object based on a background color
 * @param hexColor The hex color code
 * @returns A style object with color property
 */
export const getTextStyle = (hexColor: string): React.CSSProperties => {
  return {
    color: hexColor || "#3b82f6", // Default to blue if no color provided
  };
};

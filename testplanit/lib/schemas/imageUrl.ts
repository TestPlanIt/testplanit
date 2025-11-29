import { z } from "zod/v4";

/**
 * Schema for image URLs that accepts both:
 * - Full URLs (e.g., https://example.com/image.png)
 * - Relative paths (e.g., /api/storage/uploads/project-icons/image.png)
 *
 * This is necessary because image uploads may return either format depending
 * on the storage configuration (proxy vs presigned URLs).
 */
export const imageUrlSchema = z
  .string()
  .refine(
    (val) => {
      if (!val) return true; // Allow empty strings (will be handled by optional/nullable)
      // Check if it's a valid URL
      try {
        new URL(val);
        return true;
      } catch {
        // Not a valid URL, check if it's a valid path (starts with /)
        return val.startsWith("/");
      }
    },
    { message: "Must be a valid URL or path" }
  );

/**
 * Optional and nullable version of imageUrlSchema for form fields
 */
export const optionalImageUrlSchema = imageUrlSchema.optional().nullable();

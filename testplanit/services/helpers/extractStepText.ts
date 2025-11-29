import { extractTextFromNode } from "../../utils/extractTextFromJson";

/**
 * Safely extract text from a step field that might be JSON string or object
 */
export function extractStepText(stepData: any): string {
  if (!stepData) return "";
  
  try {
    // If it's a string, try to parse it as JSON
    if (typeof stepData === 'string') {
      const parsed = JSON.parse(stepData);
      return extractTextFromNode(parsed);
    }
    // Otherwise, assume it's already an object
    return extractTextFromNode(stepData);
  } catch (error) {
    // If parsing fails, return the original string
    return typeof stepData === 'string' ? stepData : "";
  }
}
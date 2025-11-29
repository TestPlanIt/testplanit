export const sanitizeName = (name: string): string => {
  // Remove potentially problematic characters and trim whitespace
  // Characters removed: " ' / \ : * ? < > |
  return name.replace(/["'/\\:*?<>|]/g, "_").trim();
};

export const replaceProblematicChars = (name: string): string => {
  // Only remove potentially problematic characters, without trimming
  // Characters removed: " ' / \ : * ? < > |
  return name.replace(/["'/\\:*?<>|]/g, "_");
};

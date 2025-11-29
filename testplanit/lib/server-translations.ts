import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current directory (works in both ESM and CommonJS after build)
 
// @ts-ignore - __dirname is available in CommonJS after build
const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// Cache for loaded translations
const translationCache = new Map<string, any>();

/**
 * Load translations for a specific locale
 */
async function loadTranslations(locale: string): Promise<any> {
  // Normalize locale format (es_ES -> es-ES)
  const normalizedLocale = locale.replace('_', '-');
  
  // Check cache first
  if (translationCache.has(normalizedLocale)) {
    return translationCache.get(normalizedLocale);
  }

  try {
    // Load the translation file
    const translationPath = path.join(currentDir, '..', 'messages', `${normalizedLocale}.json`);
    const translationContent = await fs.readFile(translationPath, 'utf-8');
    const translations = JSON.parse(translationContent);
    
    // Cache the translations
    translationCache.set(normalizedLocale, translations);
    
    return translations;
  } catch (error) {
    console.error(`Failed to load translations for locale ${normalizedLocale}:`, error);
    // Fall back to en-US if locale not found
    if (normalizedLocale !== 'en-US') {
      return loadTranslations('en-US');
    }
    throw error;
  }
}

/**
 * Get a translation value by key path
 */
function getTranslation(translations: any, keyPath: string): string {
  const keys = keyPath.split('.');
  let value = translations;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return keyPath; // Return the key if translation not found
    }
  }
  
  return value;
}

/**
 * Replace placeholders in translation string
 */
function replacePlaceholders(text: string, values: Record<string, any>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] !== undefined ? String(values[key]) : match;
  });
}

/**
 * Handle pluralization
 */
function handlePluralization(text: string, values: Record<string, any>): string {
  // Handle ICU MessageFormat plural syntax
  // This needs to match patterns like: {count, plural, =1 {# case} other {# cases}} in
  
  // Find plural blocks by looking for the pattern and matching braces
  let result = text;
  let startIndex = 0;
  
  while (true) {
    const pluralStart = result.indexOf('{', startIndex);
    if (pluralStart === -1) break;
    
    // Check if this is a plural pattern
    const pluralMatch = result.substring(pluralStart).match(/^\{(\w+),\s*plural,/);
    if (!pluralMatch) {
      startIndex = pluralStart + 1;
      continue;
    }
    
    const varName = pluralMatch[1];
    const count = values[varName];
    if (count === undefined) {
      startIndex = pluralStart + 1;
      continue;
    }
    
    // Find the matching closing brace
    let braceCount = 1;
    let i = pluralStart + pluralMatch[0].length;
    let pluralEnd = -1;
    
    while (i < result.length && braceCount > 0) {
      if (result[i] === '{') braceCount++;
      else if (result[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          pluralEnd = i;
          break;
        }
      }
      i++;
    }
    
    if (pluralEnd === -1) {
      startIndex = pluralStart + 1;
      continue;
    }
    
    // Extract the plural content
    const pluralContent = result.substring(pluralStart + pluralMatch[0].length, pluralEnd);
    
    // Parse the rules
    const rulesMap = new Map<string, string>();
    const rulePattern = /(=\d+|zero|one|two|few|many|other)\s*\{([^}]*)\}/g;
    let ruleMatch;
    
    while ((ruleMatch = rulePattern.exec(pluralContent)) !== null) {
      rulesMap.set(ruleMatch[1], ruleMatch[2]);
    }
    
    // Apply the appropriate rule
    let replacement = '';
    if (rulesMap.has(`=${count}`)) {
      replacement = rulesMap.get(`=${count}`)!.replace(/#/g, String(count));
    } else if (count === 0 && rulesMap.has('zero')) {
      replacement = rulesMap.get('zero')!.replace(/#/g, String(count));
    } else if (count === 1 && rulesMap.has('one')) {
      replacement = rulesMap.get('one')!.replace(/#/g, String(count));
    } else if (rulesMap.has('other')) {
      replacement = rulesMap.get('other')!.replace(/#/g, String(count));
    }
    
    // Check if there's text after the plural block but still within the content
    // Look for text after the last rule's closing brace
    const lastRuleEnd = pluralContent.lastIndexOf('}');
    if (lastRuleEnd !== -1 && lastRuleEnd < pluralContent.length - 1) {
      const followingText = pluralContent.substring(lastRuleEnd + 1);
      replacement += followingText;
    }
    
    // Replace the entire plural block with the result
    result = result.substring(0, pluralStart) + replacement + result.substring(pluralEnd + 1);
    
    // Update startIndex to continue searching after this replacement
    startIndex = pluralStart + replacement.length;
  }
  
  return result;
}

/**
 * Server-side translation function
 */
export async function getServerTranslation(
  locale: string,
  key: string,
  values?: Record<string, any>
): Promise<string> {
  try {
    const translations = await loadTranslations(locale);
    let text = getTranslation(translations, key);
    
    if (values) {
      // Handle pluralization first
      text = handlePluralization(text, values);
      // Then replace simple placeholders
      text = replacePlaceholders(text, values);
    }
    
    return text;
  } catch (error) {
    console.error(`Failed to get translation for ${key}:`, error);
    return key;
  }
}

/**
 * Get multiple translations at once
 */
export async function getServerTranslations(
  locale: string,
  keys: string[]
): Promise<Record<string, string>> {
  const translations = await loadTranslations(locale);
  const result: Record<string, string> = {};
  
  for (const key of keys) {
    result[key] = getTranslation(translations, key);
  }
  
  return result;
}

/**
 * Format locale for use in URLs
 */
export function formatLocaleForUrl(locale: string): string {
  // Convert underscore to dash for URL compatibility
  return locale.replace('_', '-');
}
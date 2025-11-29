import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatEmailDate, formatEmailDateTime } from '../server-date-formatter';

// Get the current directory (works in both ESM and CommonJS after build)
 
// @ts-ignore - __dirname is available in CommonJS after build
const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// Template cache to avoid reading files multiple times
const templateCache = new Map<string, HandlebarsTemplateDelegate<any>>();
const compiledLayouts = new Map<string, HandlebarsTemplateDelegate<any>>();

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', function(this: any, date: Date | string) {
  const locale = this.locale || 'en-US';
  return formatEmailDate(date, locale);
});

Handlebars.registerHelper('formatDateTime', function(this: any, date: Date | string) {
  const locale = this.locale || 'en-US';
  return formatEmailDateTime(date, locale);
});

Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
Handlebars.registerHelper('ne', (a: any, b: any) => a !== b);
Handlebars.registerHelper('gt', (a: any, b: any) => a > b);
Handlebars.registerHelper('gte', (a: any, b: any) => a >= b);
Handlebars.registerHelper('lt', (a: any, b: any) => a < b);
Handlebars.registerHelper('lte', (a: any, b: any) => a <= b);

// Helper to get translation
Handlebars.registerHelper('t', function(this: any, key: string, options?: any) {
  // Access translations from root context to handle nested contexts (e.g., inside {{#each}})
  const translations = (options?.data?.root?.translations || this.translations) || {};
  const value = translations[key] || key;

  // Handle replacements if options.hash exists
  if (options && options.hash) {
    return value.replace(/\{(\w+)\}/g, (match: string, param: string) => {
      return options.hash[param] !== undefined ? options.hash[param] : match;
    });
  }

  return value;
});

// Helper to load and compile a template
async function loadTemplate(templatePath: string): Promise<HandlebarsTemplateDelegate<any>> {
  const cached = templateCache.get(templatePath);
  if (cached) {
    return cached;
  }

  const templateContent = await fs.readFile(templatePath, 'utf-8');
  const compiled = Handlebars.compile(templateContent);
  templateCache.set(templatePath, compiled);
  return compiled;
}

// Helper to load and compile layout
async function loadLayout(layoutName: string): Promise<HandlebarsTemplateDelegate<any>> {
  const cached = compiledLayouts.get(layoutName);
  if (cached) {
    return cached;
  }

  const layoutPath = path.join(currentDir, 'templates', 'layouts', `${layoutName}.hbs`);
  const layoutContent = await fs.readFile(layoutPath, 'utf-8');
  const compiled = Handlebars.compile(layoutContent);
  compiledLayouts.set(layoutName, compiled);
  return compiled;
}

// Register partials on startup
export async function registerPartials() {
  const partialsDir = path.join(currentDir, 'templates', 'partials');
  
  try {
    const files = await fs.readdir(partialsDir);
    
    for (const file of files) {
      if (file.endsWith('.hbs')) {
        const partialName = path.basename(file, '.hbs');
        const partialPath = path.join(partialsDir, file);
        const partialContent = await fs.readFile(partialPath, 'utf-8');
        Handlebars.registerPartial(partialName, partialContent);
      }
    }
  } catch (error) {
    console.warn('No partials directory found or error loading partials:', error);
  }
}

export interface EmailTemplateData {
  [key: string]: any;
}

export interface EmailRenderOptions {
  layout?: string;
  subject?: string;
}

/**
 * Renders an email template with the given data
 * @param templateName Name of the template file (without .hbs extension)
 * @param data Template data
 * @param options Rendering options
 * @returns Rendered HTML string
 */
export async function renderEmailTemplate(
  templateName: string,
  data: EmailTemplateData,
  options: EmailRenderOptions = {}
): Promise<{ html: string; subject: string }> {
  // Default layout
  const layoutName = options.layout || 'main';
  
  // Load template
  const templatePath = path.join(currentDir, 'templates', `${templateName}.hbs`);
  const template = await loadTemplate(templatePath);
  
  // Render template content
  const content = template(data);
  
  // Load and render layout with content
  const layout = await loadLayout(layoutName);
  const html = layout({
    ...data,
    content,
    subject: options.subject || data.subject || 'TestPlanIt Notification',
  });
  
  return {
    html,
    subject: options.subject || data.subject || 'TestPlanIt Notification',
  };
}

// Initialize partials when the module is imported
registerPartials().catch(console.error);
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/prismaBase.ts
var prismaBase_exports = {};
__export(prismaBase_exports, {
  prisma: () => prisma
});
var import_client, prismaClient, prisma;
var init_prismaBase = __esm({
  "lib/prismaBase.ts"() {
    "use strict";
    import_client = require("@prisma/client");
    if (process.env.NODE_ENV === "production") {
      prismaClient = new import_client.PrismaClient({
        errorFormat: "pretty"
      });
    } else {
      if (!global.prismaBase) {
        global.prismaBase = new import_client.PrismaClient({
          errorFormat: "colorless"
        });
      }
      prismaClient = global.prismaBase;
    }
    prisma = prismaClient;
  }
});

// workers/emailWorker.ts
var emailWorker_exports = {};
__export(emailWorker_exports, {
  default: () => emailWorker_default
});
module.exports = __toCommonJS(emailWorker_exports);
var import_bullmq2 = require("bullmq");

// lib/valkey.ts
var import_ioredis = __toESM(require("ioredis"));
var skipConnection = process.env.SKIP_VALKEY_CONNECTION === "true";
var valkeyUrl = process.env.VALKEY_URL;
if (!valkeyUrl && !skipConnection) {
  console.error(
    "VALKEY_URL environment variable is not set. Background jobs may fail."
  );
}
var connectionOptions = {
  maxRetriesPerRequest: null,
  // Required by BullMQ
  enableReadyCheck: false
  // Optional: Sometimes helps with startup race conditions
};
var valkeyConnection = null;
if (valkeyUrl && !skipConnection) {
  const connectionUrl = valkeyUrl.replace(/^valkey:\/\//, "redis://");
  valkeyConnection = new import_ioredis.default(connectionUrl, connectionOptions);
  valkeyConnection.on("connect", () => {
    console.log("Successfully connected to Valkey.");
  });
  valkeyConnection.on("error", (err) => {
    console.error("Valkey connection error:", err);
  });
} else {
  console.warn("Valkey URL not provided. Valkey connection not established.");
}
var valkey_default = valkeyConnection;

// lib/queues.ts
var import_bullmq = require("bullmq");

// lib/queueNames.ts
var EMAIL_QUEUE_NAME = "emails";

// lib/email/notificationTemplates.ts
var import_nodemailer = __toESM(require("nodemailer"));

// lib/email/template-service.ts
var import_handlebars = __toESM(require("handlebars"));
var import_promises = __toESM(require("fs/promises"));
var import_path = __toESM(require("path"));
var import_url = require("url");

// lib/server-date-formatter.ts
var import_date_fns = require("date-fns");
var import_en_US = require("date-fns/locale/en-US");
var import_es = require("date-fns/locale/es");
var import_fr = require("date-fns/locale/fr");
var localeMap = {
  "en-US": import_en_US.enUS,
  "en_US": import_en_US.enUS,
  "es-ES": import_es.es,
  "es_ES": import_es.es,
  "fr-FR": import_fr.fr,
  "fr_FR": import_fr.fr
};
function getServerDateFnsLocale(locale) {
  const normalizedLocale = locale.replace("_", "-");
  return localeMap[normalizedLocale] || localeMap[locale] || import_en_US.enUS;
}
function formatDateWithLocale(date, formatString, locale) {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const dateLocale = getServerDateFnsLocale(locale);
  return (0, import_date_fns.format)(dateObj, formatString, { locale: dateLocale });
}
function formatEmailDate(date, locale) {
  return formatDateWithLocale(date, "MMMM d, yyyy", locale);
}
function formatEmailDateTime(date, locale) {
  const atWordMap = {
    "en": "at",
    "es": "a las",
    "fr": "\xE0"
  };
  const langCode = locale.substring(0, 2);
  const atWord = atWordMap[langCode] || "at";
  return formatDateWithLocale(date, `MMMM d, yyyy '${atWord}' hh:mm a`, locale);
}

// lib/email/template-service.ts
var import_meta = {};
var currentDir = typeof __dirname !== "undefined" ? __dirname : import_path.default.dirname((0, import_url.fileURLToPath)(import_meta.url));
var templateCache = /* @__PURE__ */ new Map();
var compiledLayouts = /* @__PURE__ */ new Map();
import_handlebars.default.registerHelper("formatDate", function(date) {
  const locale = this.locale || "en-US";
  return formatEmailDate(date, locale);
});
import_handlebars.default.registerHelper("formatDateTime", function(date) {
  const locale = this.locale || "en-US";
  return formatEmailDateTime(date, locale);
});
import_handlebars.default.registerHelper("eq", (a, b) => a === b);
import_handlebars.default.registerHelper("ne", (a, b) => a !== b);
import_handlebars.default.registerHelper("gt", (a, b) => a > b);
import_handlebars.default.registerHelper("gte", (a, b) => a >= b);
import_handlebars.default.registerHelper("lt", (a, b) => a < b);
import_handlebars.default.registerHelper("lte", (a, b) => a <= b);
import_handlebars.default.registerHelper("t", function(key, options) {
  const translations = options?.data?.root?.translations || this.translations || {};
  const value = translations[key] || key;
  if (options && options.hash) {
    return value.replace(/\{(\w+)\}/g, (match, param) => {
      return options.hash[param] !== void 0 ? options.hash[param] : match;
    });
  }
  return value;
});
async function loadTemplate(templatePath) {
  const cached = templateCache.get(templatePath);
  if (cached) {
    return cached;
  }
  const templateContent = await import_promises.default.readFile(templatePath, "utf-8");
  const compiled = import_handlebars.default.compile(templateContent);
  templateCache.set(templatePath, compiled);
  return compiled;
}
async function loadLayout(layoutName) {
  const cached = compiledLayouts.get(layoutName);
  if (cached) {
    return cached;
  }
  const layoutPath = import_path.default.join(currentDir, "templates", "layouts", `${layoutName}.hbs`);
  const layoutContent = await import_promises.default.readFile(layoutPath, "utf-8");
  const compiled = import_handlebars.default.compile(layoutContent);
  compiledLayouts.set(layoutName, compiled);
  return compiled;
}
async function registerPartials() {
  const partialsDir = import_path.default.join(currentDir, "templates", "partials");
  try {
    const files = await import_promises.default.readdir(partialsDir);
    for (const file of files) {
      if (file.endsWith(".hbs")) {
        const partialName = import_path.default.basename(file, ".hbs");
        const partialPath = import_path.default.join(partialsDir, file);
        const partialContent = await import_promises.default.readFile(partialPath, "utf-8");
        import_handlebars.default.registerPartial(partialName, partialContent);
      }
    }
  } catch (error) {
    console.warn("No partials directory found or error loading partials:", error);
  }
}
async function renderEmailTemplate(templateName, data, options = {}) {
  const layoutName = options.layout || "main";
  const templatePath = import_path.default.join(currentDir, "templates", `${templateName}.hbs`);
  const template = await loadTemplate(templatePath);
  const content = template(data);
  const layout = await loadLayout(layoutName);
  const html = layout({
    ...data,
    content,
    subject: options.subject || data.subject || "TestPlanIt Notification"
  });
  return {
    html,
    subject: options.subject || data.subject || "TestPlanIt Notification"
  };
}
registerPartials().catch(console.error);

// lib/email/notificationTemplates.ts
var getTransporter = () => {
  return import_nodemailer.default.createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port: Number(process.env.EMAIL_SERVER_PORT) || 0,
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD
    },
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`
  });
};
async function sendNotificationEmail(data) {
  const transporter = getTransporter();
  const { html, subject } = await renderEmailTemplate("notification", {
    userName: data.userName,
    notification: {
      title: data.notificationTitle,
      message: data.notificationMessage,
      htmlMessage: data.htmlMessage,
      createdAt: /* @__PURE__ */ new Date()
    },
    notificationUrl: data.notificationUrl,
    appUrl: process.env.NEXTAUTH_URL || "http://localhost:3000",
    locale: data.locale || "en-US",
    userId: data.userId,
    currentYear: (/* @__PURE__ */ new Date()).getFullYear(),
    subject: `TestPlanIt: ${data.notificationTitle}`,
    translations: data.translations || {}
  });
  const emailData = {
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`,
    to: data.to,
    subject,
    html
  };
  try {
    await transporter.sendMail(emailData);
  } catch (error) {
    console.error("Failed to send notification email:", error);
    throw error;
  }
}
async function sendDigestEmail(data) {
  const transporter = getTransporter();
  const { html, subject } = await renderEmailTemplate("daily-digest", {
    userName: data.userName,
    notifications: data.notifications,
    appUrl: process.env.NEXTAUTH_URL || "http://localhost:3000",
    locale: data.locale || "en-US",
    userId: data.userId,
    currentYear: (/* @__PURE__ */ new Date()).getFullYear(),
    subject: `TestPlanIt Daily Digest - ${data.notifications.length} notifications`,
    translations: data.translations || {}
  });
  const emailData = {
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`,
    to: data.to,
    subject,
    html
  };
  try {
    await transporter.sendMail(emailData);
  } catch (error) {
    console.error("Failed to send digest email:", error);
    throw error;
  }
}

// workers/emailWorker.ts
var import_node_url = require("node:url");

// lib/server-translations.ts
var import_promises2 = __toESM(require("fs/promises"));
var import_path2 = __toESM(require("path"));
var import_url2 = require("url");
var import_meta2 = {};
var currentDir2 = typeof __dirname !== "undefined" ? __dirname : import_path2.default.dirname((0, import_url2.fileURLToPath)(import_meta2.url));
var translationCache = /* @__PURE__ */ new Map();
async function loadTranslations(locale) {
  const normalizedLocale = locale.replace("_", "-");
  if (translationCache.has(normalizedLocale)) {
    return translationCache.get(normalizedLocale);
  }
  try {
    const translationPath = import_path2.default.join(currentDir2, "..", "messages", `${normalizedLocale}.json`);
    const translationContent = await import_promises2.default.readFile(translationPath, "utf-8");
    const translations = JSON.parse(translationContent);
    translationCache.set(normalizedLocale, translations);
    return translations;
  } catch (error) {
    console.error(`Failed to load translations for locale ${normalizedLocale}:`, error);
    if (normalizedLocale !== "en-US") {
      return loadTranslations("en-US");
    }
    throw error;
  }
}
function getTranslation(translations, keyPath) {
  const keys = keyPath.split(".");
  let value = translations;
  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = value[key];
    } else {
      return keyPath;
    }
  }
  return value;
}
function replacePlaceholders(text, values) {
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] !== void 0 ? String(values[key]) : match;
  });
}
function handlePluralization(text, values) {
  let result = text;
  let startIndex = 0;
  while (true) {
    const pluralStart = result.indexOf("{", startIndex);
    if (pluralStart === -1) break;
    const pluralMatch = result.substring(pluralStart).match(/^\{(\w+),\s*plural,/);
    if (!pluralMatch) {
      startIndex = pluralStart + 1;
      continue;
    }
    const varName = pluralMatch[1];
    const count = values[varName];
    if (count === void 0) {
      startIndex = pluralStart + 1;
      continue;
    }
    let braceCount = 1;
    let i = pluralStart + pluralMatch[0].length;
    let pluralEnd = -1;
    while (i < result.length && braceCount > 0) {
      if (result[i] === "{") braceCount++;
      else if (result[i] === "}") {
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
    const pluralContent = result.substring(pluralStart + pluralMatch[0].length, pluralEnd);
    const rulesMap = /* @__PURE__ */ new Map();
    const rulePattern = /(=\d+|zero|one|two|few|many|other)\s*\{([^}]*)\}/g;
    let ruleMatch;
    while ((ruleMatch = rulePattern.exec(pluralContent)) !== null) {
      rulesMap.set(ruleMatch[1], ruleMatch[2]);
    }
    let replacement = "";
    if (rulesMap.has(`=${count}`)) {
      replacement = rulesMap.get(`=${count}`).replace(/#/g, String(count));
    } else if (count === 0 && rulesMap.has("zero")) {
      replacement = rulesMap.get("zero").replace(/#/g, String(count));
    } else if (count === 1 && rulesMap.has("one")) {
      replacement = rulesMap.get("one").replace(/#/g, String(count));
    } else if (rulesMap.has("other")) {
      replacement = rulesMap.get("other").replace(/#/g, String(count));
    }
    const lastRuleEnd = pluralContent.lastIndexOf("}");
    if (lastRuleEnd !== -1 && lastRuleEnd < pluralContent.length - 1) {
      const followingText = pluralContent.substring(lastRuleEnd + 1);
      replacement += followingText;
    }
    result = result.substring(0, pluralStart) + replacement + result.substring(pluralEnd + 1);
    startIndex = pluralStart + replacement.length;
  }
  return result;
}
async function getServerTranslation(locale, key, values) {
  try {
    const translations = await loadTranslations(locale);
    let text = getTranslation(translations, key);
    if (values) {
      text = handlePluralization(text, values);
      text = replacePlaceholders(text, values);
    }
    return text;
  } catch (error) {
    console.error(`Failed to get translation for ${key}:`, error);
    return key;
  }
}
async function getServerTranslations(locale, keys) {
  const translations = await loadTranslations(locale);
  const result = {};
  for (const key of keys) {
    result[key] = getTranslation(translations, key);
  }
  return result;
}
function formatLocaleForUrl(locale) {
  return locale.replace("_", "-");
}

// utils/tiptapToHtml.ts
function generateHTMLFallback(content) {
  if (!content || !content.content) {
    return "<div></div>";
  }
  function processNode(node) {
    if (!node) return "";
    switch (node.type) {
      case "doc":
        return node.content?.map(processNode).join("") || "";
      case "paragraph":
        const pContent = node.content?.map(processNode).join("") || "";
        return `<p>${pContent}</p>`;
      case "text":
        let text = node.text || "";
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case "bold":
                text = `<strong>${text}</strong>`;
                break;
              case "italic":
                text = `<em>${text}</em>`;
                break;
              case "link":
                const href = mark.attrs?.href || "#";
                const target = mark.attrs?.target || "_blank";
                text = `<a href="${href}" target="${target}" rel="noopener noreferrer">${text}</a>`;
                break;
            }
          }
        }
        return text;
      case "heading":
        const level = node.attrs?.level || 1;
        const hContent = node.content?.map(processNode).join("") || "";
        return `<h${level}>${hContent}</h${level}>`;
      case "bulletList":
        const ulContent = node.content?.map(processNode).join("") || "";
        return `<ul>${ulContent}</ul>`;
      case "listItem":
        const liContent = node.content?.map(processNode).join("") || "";
        return `<li>${liContent}</li>`;
      case "image":
        const src = node.attrs?.src || "";
        const alt = node.attrs?.alt || "";
        return `<img src="${src}" alt="${alt}" style="max-width: 100%; height: auto;" />`;
      default:
        return node.content?.map(processNode).join("") || "";
    }
  }
  return processNode(content);
}
function tiptapToHtml(json) {
  try {
    let content;
    if (typeof json === "string") {
      try {
        content = JSON.parse(json);
      } catch {
        return `<p>${json}</p>`;
      }
    } else {
      content = json;
    }
    const html = generateHTMLFallback(content);
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">${html}</div>`;
  } catch (error) {
    console.error("Failed to convert TipTap to HTML:", error);
    return `<p>${String(json)}</p>`;
  }
}
function isTipTapContent(content) {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return !!(parsed && typeof parsed === "object" && (parsed.type === "doc" || parsed.content));
  } catch {
    return false;
  }
}

// lib/multiTenantPrisma.ts
var import_client2 = require("@prisma/client");
function isMultiTenantMode() {
  return process.env.MULTI_TENANT_MODE === "true";
}
var tenantClients = /* @__PURE__ */ new Map();
var tenantConfigs = null;
function loadTenantConfigs() {
  if (tenantConfigs) {
    return tenantConfigs;
  }
  tenantConfigs = /* @__PURE__ */ new Map();
  const configJson = process.env.TENANT_CONFIGS;
  if (configJson) {
    try {
      const configs = JSON.parse(configJson);
      for (const [tenantId, config] of Object.entries(configs)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex
        });
      }
      console.log(`Loaded ${tenantConfigs.size} tenant configurations from TENANT_CONFIGS`);
    } catch (error) {
      console.error("Failed to parse TENANT_CONFIGS:", error);
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^TENANT_([A-Z0-9_]+)_DATABASE_URL$/);
    if (match && value) {
      const tenantId = match[1].toLowerCase();
      if (!tenantConfigs.has(tenantId)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: value,
          elasticsearchNode: process.env[`TENANT_${match[1]}_ELASTICSEARCH_NODE`],
          elasticsearchIndex: process.env[`TENANT_${match[1]}_ELASTICSEARCH_INDEX`]
        });
      }
    }
  }
  if (tenantConfigs.size === 0) {
    console.warn("No tenant configurations found. Multi-tenant mode will not work without configurations.");
  }
  return tenantConfigs;
}
function getTenantConfig(tenantId) {
  const configs = loadTenantConfigs();
  return configs.get(tenantId);
}
function createTenantPrismaClient(config) {
  const client = new import_client2.PrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl
      }
    },
    errorFormat: "pretty"
  });
  return client;
}
function getTenantPrismaClient(tenantId) {
  let client = tenantClients.get(tenantId);
  if (client) {
    return client;
  }
  const config = getTenantConfig(tenantId);
  if (!config) {
    throw new Error(`No configuration found for tenant: ${tenantId}`);
  }
  client = createTenantPrismaClient(config);
  tenantClients.set(tenantId, client);
  console.log(`Created Prisma client for tenant: ${tenantId}`);
  return client;
}
function getPrismaClientForJob(jobData) {
  if (!isMultiTenantMode()) {
    const { prisma: prisma2 } = (init_prismaBase(), __toCommonJS(prismaBase_exports));
    return prisma2;
  }
  if (!jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }
  return getTenantPrismaClient(jobData.tenantId);
}
async function disconnectAllTenantClients() {
  const disconnectPromises = [];
  for (const [tenantId, client] of tenantClients) {
    console.log(`Disconnecting Prisma client for tenant: ${tenantId}`);
    disconnectPromises.push(client.$disconnect());
  }
  await Promise.all(disconnectPromises);
  tenantClients.clear();
  console.log("All tenant Prisma clients disconnected");
}
function validateMultiTenantJobData(jobData) {
  if (isMultiTenantMode() && !jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }
}

// workers/emailWorker.ts
var import_meta3 = {};
var processor = async (job) => {
  console.log(`Processing email job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);
  validateMultiTenantJobData(job.data);
  const prisma2 = getPrismaClientForJob(job.data);
  switch (job.name) {
    case "send-notification-email":
      const notificationData = job.data;
      try {
        const notification = await prisma2.notification.findUnique({
          where: { id: notificationData.notificationId },
          include: {
            user: {
              include: {
                userPreferences: true
              }
            }
          }
        });
        if (!notification || !notification.user.email) {
          console.log("Notification or user email not found");
          return;
        }
        let notificationUrl;
        const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
        const userLocale = notification.user.userPreferences?.locale || "en_US";
        const urlLocale = formatLocaleForUrl(userLocale);
        const data = notification.data || {};
        if (notification.type === "WORK_ASSIGNED" && !data.isBulkAssignment) {
          if (data.projectId && data.testRunId && data.testCaseId) {
            notificationUrl = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}?selectedCase=${data.testCaseId}`;
          }
        } else if (notification.type === "SESSION_ASSIGNED") {
          if (data.projectId && data.sessionId) {
            notificationUrl = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
          }
        }
        let translatedTitle = notification.title;
        let translatedMessage = notification.message;
        let htmlMessage;
        if (notification.type === "WORK_ASSIGNED" && !data.isBulkAssignment) {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.testCaseAssignmentTitle"
          );
          translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedTestCase")} "${data.testCaseName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
        } else if (notification.type === "WORK_ASSIGNED" && data.isBulkAssignment) {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.multipleTestCaseAssignmentTitle"
          );
          translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedMultipleTestCases", { count: data.count })}`;
        } else if (notification.type === "SESSION_ASSIGNED") {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.sessionAssignmentTitle"
          );
          translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedSession")} "${data.sessionName || data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
        } else if (notification.type === "COMMENT_MENTION") {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.commentMentionTitle"
          );
          translatedMessage = `${data.creatorName} ${await getServerTranslation(userLocale, "components.notifications.content.mentionedYouInComment")} "${data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
          if (data.projectId && data.hasProjectAccess) {
            if (data.entityType === "RepositoryCase" && data.repositoryCaseId) {
              notificationUrl = `${baseUrl}/${urlLocale}/projects/repository/${data.projectId}/${data.repositoryCaseId}`;
            } else if (data.entityType === "TestRun" && data.testRunId) {
              notificationUrl = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}`;
            } else if (data.entityType === "Session" && data.sessionId) {
              notificationUrl = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
            }
          }
        } else if (notification.type === "SYSTEM_ANNOUNCEMENT") {
          if (data.richContent && isTipTapContent(data.richContent)) {
            htmlMessage = tiptapToHtml(data.richContent);
          }
          if (!htmlMessage && data.sentByName) {
            translatedMessage += `

${await getServerTranslation(userLocale, "components.notifications.content.sentBy", { name: data.sentByName })}`;
          }
        }
        const emailTranslations = await getServerTranslations(userLocale, [
          "email.greeting",
          "email.greetingWithName",
          "email.notification.intro",
          "email.notification.viewDetails",
          "email.notification.viewAll",
          "email.footer.sentBy",
          "email.footer.unsubscribe",
          "email.footer.managePreferences",
          "email.footer.allRightsReserved"
        ]);
        await sendNotificationEmail({
          to: notification.user.email,
          userId: notification.userId,
          userName: notification.user.name,
          notificationTitle: translatedTitle,
          notificationMessage: translatedMessage,
          notificationUrl,
          locale: urlLocale,
          translations: emailTranslations,
          htmlMessage
        });
        console.log(`Sent notification email to ${notification.user.email}`);
      } catch (error) {
        console.error(`Failed to send notification email:`, error);
        throw error;
      }
      break;
    case "send-digest-email":
      const digestData = job.data;
      try {
        const user = await prisma2.user.findUnique({
          where: { id: digestData.userId },
          include: {
            userPreferences: true
          }
        });
        if (!user || !user.email) {
          console.log("User or email not found");
          return;
        }
        const fullNotifications = await prisma2.notification.findMany({
          where: {
            id: { in: digestData.notifications.map((n) => n.id) }
          }
        });
        const notificationsWithUrls = await Promise.all(
          fullNotifications.map(async (notification) => {
            const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
            const userLocale = user.userPreferences?.locale || "en_US";
            const urlLocale = formatLocaleForUrl(userLocale);
            const data = notification.data || {};
            let url;
            if (notification.type === "WORK_ASSIGNED" && !data.isBulkAssignment) {
              if (data.projectId && data.testRunId && data.testCaseId) {
                url = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}?selectedCase=${data.testCaseId}`;
              }
            } else if (notification.type === "SESSION_ASSIGNED") {
              if (data.projectId && data.sessionId) {
                url = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
              }
            } else if (notification.type === "COMMENT_MENTION") {
              if (data.projectId && data.hasProjectAccess) {
                if (data.entityType === "RepositoryCase" && data.repositoryCaseId) {
                  url = `${baseUrl}/${urlLocale}/projects/repository/${data.projectId}/${data.repositoryCaseId}`;
                } else if (data.entityType === "TestRun" && data.testRunId) {
                  url = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}`;
                } else if (data.entityType === "Session" && data.sessionId) {
                  url = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
                }
              }
            }
            let translatedTitle = notification.title;
            let translatedMessage = notification.message;
            if (notification.type === "WORK_ASSIGNED" && !data.isBulkAssignment) {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.testCaseAssignmentTitle"
              );
              translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedTestCase")} "${data.testCaseName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
            } else if (notification.type === "WORK_ASSIGNED" && data.isBulkAssignment) {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.multipleTestCaseAssignmentTitle"
              );
              translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedMultipleTestCases", { count: data.count })}`;
            } else if (notification.type === "SESSION_ASSIGNED") {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.sessionAssignmentTitle"
              );
              translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedSession")} "${data.sessionName || data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
            } else if (notification.type === "COMMENT_MENTION") {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.commentMentionTitle"
              );
              translatedMessage = `${data.creatorName} ${await getServerTranslation(userLocale, "components.notifications.content.mentionedYouInComment")} "${data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
            }
            return {
              id: notification.id,
              title: translatedTitle,
              message: translatedMessage,
              createdAt: notification.createdAt,
              url
            };
          })
        );
        const digestUserLocale = user.userPreferences?.locale || "en_US";
        const digestTranslations = await getServerTranslations(
          digestUserLocale,
          [
            "email.greeting",
            "email.greetingWithName",
            "email.digest.intro",
            "email.digest.viewDetails",
            "email.digest.viewAll",
            "email.digest.noNotifications",
            "email.digest.footer",
            "email.digest.profileSettings",
            "email.footer.sentBy",
            "email.footer.unsubscribe",
            "email.footer.managePreferences",
            "email.footer.allRightsReserved"
          ]
        );
        await sendDigestEmail({
          to: user.email,
          userId: user.id,
          userName: user.name,
          notifications: notificationsWithUrls,
          locale: formatLocaleForUrl(user.userPreferences?.locale || "en_US"),
          translations: digestTranslations
        });
        await prisma2.notification.updateMany({
          where: {
            id: { in: digestData.notifications.map((n) => n.id) }
          },
          data: { isRead: true }
        });
        console.log(
          `Sent digest email to ${user.email} with ${digestData.notifications.length} notifications`
        );
      } catch (error) {
        console.error(`Failed to send digest email:`, error);
        throw error;
      }
      break;
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
};
var worker = null;
var startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("Email worker starting in MULTI-TENANT mode");
  } else {
    console.log("Email worker starting in SINGLE-TENANT mode");
  }
  if (valkey_default) {
    worker = new import_bullmq2.Worker(EMAIL_QUEUE_NAME, processor, {
      connection: valkey_default,
      concurrency: 3
    });
    worker.on("completed", (job) => {
      console.log(`Email job ${job.id} completed successfully.`);
    });
    worker.on("failed", (job, err) => {
      console.error(`Email job ${job?.id} failed:`, err);
    });
    worker.on("error", (err) => {
      console.error("Email worker error:", err);
    });
    console.log(`Email worker started for queue "${EMAIL_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Email worker not started.");
  }
  process.on("SIGINT", async () => {
    console.log("Shutting down email worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};
if (typeof import_meta3 !== "undefined" && import_meta3.url === (0, import_node_url.pathToFileURL)(process.argv[1]).href || (typeof import_meta3 === "undefined" || import_meta3.url === void 0)) {
  console.log("Email worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start email worker:", err);
    process.exit(1);
  });
}
var emailWorker_default = worker;
//# sourceMappingURL=emailWorker.js.map

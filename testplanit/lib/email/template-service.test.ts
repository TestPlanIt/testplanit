import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Handlebars from "handlebars";

// Mock fs/promises
const mockReadFile = vi.fn();
const mockReaddir = vi.fn();

vi.mock("fs/promises", () => ({
  default: {
    readFile: (...args: any[]) => mockReadFile(...args),
    readdir: (...args: any[]) => mockReaddir(...args),
  },
  readFile: (...args: any[]) => mockReadFile(...args),
  readdir: (...args: any[]) => mockReaddir(...args),
}));

// Mock the server-date-formatter
vi.mock("../server-date-formatter", () => ({
  formatEmailDate: (date: Date | string, locale: string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString(locale);
  },
  formatEmailDateTime: (date: Date | string, locale: string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString(locale);
  },
}));

// Mock fileURLToPath
vi.mock("url", () => ({
  fileURLToPath: () => "/mocked/path",
}));

describe("Email Template Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear Handlebars registrations
    Handlebars.unregisterHelper("formatDate");
    Handlebars.unregisterHelper("formatDateTime");
    Handlebars.unregisterHelper("eq");
    Handlebars.unregisterHelper("ne");
    Handlebars.unregisterHelper("gt");
    Handlebars.unregisterHelper("gte");
    Handlebars.unregisterHelper("lt");
    Handlebars.unregisterHelper("lte");
    Handlebars.unregisterHelper("t");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Handlebars Helpers", () => {
    beforeEach(() => {
      // Register helpers manually for testing
      Handlebars.registerHelper("formatDate", function (
        this: any,
        date: Date | string
      ) {
        const locale = this.locale || "en-US";
        const d = typeof date === "string" ? new Date(date) : date;
        return d.toLocaleDateString(locale);
      });

      Handlebars.registerHelper("formatDateTime", function (
        this: any,
        date: Date | string
      ) {
        const locale = this.locale || "en-US";
        const d = typeof date === "string" ? new Date(date) : date;
        return d.toLocaleString(locale);
      });

      Handlebars.registerHelper("eq", (a: any, b: any) => a === b);
      Handlebars.registerHelper("ne", (a: any, b: any) => a !== b);
      Handlebars.registerHelper("gt", (a: any, b: any) => a > b);
      Handlebars.registerHelper("gte", (a: any, b: any) => a >= b);
      Handlebars.registerHelper("lt", (a: any, b: any) => a < b);
      Handlebars.registerHelper("lte", (a: any, b: any) => a <= b);

      Handlebars.registerHelper("t", function (
        this: any,
        key: string,
        options?: any
      ) {
        const translations =
          (options?.data?.root?.translations || this.translations) || {};
        const value = translations[key] || key;

        if (options && options.hash) {
          return value.replace(
            /\{(\w+)\}/g,
            (match: string, param: string) => {
              return options.hash[param] !== undefined
                ? options.hash[param]
                : match;
            }
          );
        }

        return value;
      });
    });

    describe("formatDate helper", () => {
      it("should format a Date object", () => {
        const template = Handlebars.compile("{{formatDate date}}");
        const date = new Date("2024-01-15");
        const result = template({ date, locale: "en-US" });
        expect(result).toContain("2024");
      });

      it("should format a date string", () => {
        const template = Handlebars.compile("{{formatDate date}}");
        const result = template({ date: "2024-01-15", locale: "en-US" });
        expect(result).toContain("2024");
      });

      it("should use default locale when not provided", () => {
        const template = Handlebars.compile("{{formatDate date}}");
        const result = template({ date: new Date("2024-01-15") });
        expect(result).toBeTruthy();
      });
    });

    describe("formatDateTime helper", () => {
      it("should format date with time", () => {
        const template = Handlebars.compile("{{formatDateTime date}}");
        const date = new Date("2024-01-15T10:30:00");
        const result = template({ date, locale: "en-US" });
        expect(result).toContain("2024");
      });
    });

    describe("comparison helpers", () => {
      it("eq should return true for equal values", () => {
        const template = Handlebars.compile(
          "{{#if (eq a b)}}equal{{else}}not equal{{/if}}"
        );
        expect(template({ a: 5, b: 5 })).toBe("equal");
        expect(template({ a: 5, b: 6 })).toBe("not equal");
      });

      it("ne should return true for not equal values", () => {
        const template = Handlebars.compile(
          "{{#if (ne a b)}}not equal{{else}}equal{{/if}}"
        );
        expect(template({ a: 5, b: 6 })).toBe("not equal");
        expect(template({ a: 5, b: 5 })).toBe("equal");
      });

      it("gt should return true when a > b", () => {
        const template = Handlebars.compile(
          "{{#if (gt a b)}}greater{{else}}not greater{{/if}}"
        );
        expect(template({ a: 10, b: 5 })).toBe("greater");
        expect(template({ a: 5, b: 10 })).toBe("not greater");
      });

      it("gte should return true when a >= b", () => {
        const template = Handlebars.compile(
          "{{#if (gte a b)}}gte{{else}}less{{/if}}"
        );
        expect(template({ a: 10, b: 5 })).toBe("gte");
        expect(template({ a: 5, b: 5 })).toBe("gte");
        expect(template({ a: 4, b: 5 })).toBe("less");
      });

      it("lt should return true when a < b", () => {
        const template = Handlebars.compile(
          "{{#if (lt a b)}}less{{else}}not less{{/if}}"
        );
        expect(template({ a: 5, b: 10 })).toBe("less");
        expect(template({ a: 10, b: 5 })).toBe("not less");
      });

      it("lte should return true when a <= b", () => {
        const template = Handlebars.compile(
          "{{#if (lte a b)}}lte{{else}}greater{{/if}}"
        );
        expect(template({ a: 5, b: 10 })).toBe("lte");
        expect(template({ a: 5, b: 5 })).toBe("lte");
        expect(template({ a: 6, b: 5 })).toBe("greater");
      });
    });

    describe("translation helper (t)", () => {
      it("should return translated value", () => {
        const template = Handlebars.compile("{{t 'greeting'}}");
        const result = template({
          translations: { greeting: "Hello!" },
        });
        expect(result).toBe("Hello!");
      });

      it("should return key if translation not found", () => {
        const template = Handlebars.compile("{{t 'missing_key'}}");
        const result = template({ translations: {} });
        expect(result).toBe("missing_key");
      });

      it("should handle parameter replacement", () => {
        const template = Handlebars.compile('{{t "welcome" name="John"}}');
        const result = template({
          translations: { welcome: "Hello, {name}!" },
        });
        expect(result).toBe("Hello, John!");
      });

      it("should handle multiple parameters", () => {
        const template = Handlebars.compile(
          '{{t "message" count="5" type="bugs"}}'
        );
        const result = template({
          translations: { message: "Found {count} {type}" },
        });
        expect(result).toBe("Found 5 bugs");
      });

      it("should keep placeholder if parameter not provided", () => {
        const template = Handlebars.compile('{{t "message" count="5"}}');
        const result = template({
          translations: { message: "Found {count} {type}" },
        });
        expect(result).toBe("Found 5 {type}");
      });

      it("should work inside #each blocks", () => {
        const template = Handlebars.compile(
          "{{#each items}}{{t 'item'}} {{/each}}"
        );
        const result = template({
          items: [1, 2, 3],
          translations: { item: "Test" },
        });
        expect(result).toBe("Test Test Test ");
      });
    });
  });

  describe("Template Rendering", () => {
    it("should compile and render a simple template", () => {
      const template = Handlebars.compile("<h1>{{title}}</h1>");
      const result = template({ title: "Hello World" });
      expect(result).toBe("<h1>Hello World</h1>");
    });

    it("should handle nested data", () => {
      const template = Handlebars.compile(
        "<p>{{user.name}} - {{user.email}}</p>"
      );
      const result = template({
        user: { name: "John", email: "john@example.com" },
      });
      expect(result).toBe("<p>John - john@example.com</p>");
    });

    it("should handle arrays with #each", () => {
      const template = Handlebars.compile(
        "<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>"
      );
      const result = template({ items: ["A", "B", "C"] });
      expect(result).toBe("<ul><li>A</li><li>B</li><li>C</li></ul>");
    });

    it("should handle conditionals", () => {
      const template = Handlebars.compile(
        "{{#if show}}Visible{{else}}Hidden{{/if}}"
      );
      expect(template({ show: true })).toBe("Visible");
      expect(template({ show: false })).toBe("Hidden");
    });

    it("should escape HTML by default", () => {
      const template = Handlebars.compile("<p>{{content}}</p>");
      const result = template({ content: "<script>alert('xss')</script>" });
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });

    it("should allow unescaped HTML with triple braces", () => {
      const template = Handlebars.compile("<div>{{{content}}}</div>");
      const result = template({ content: "<strong>Bold</strong>" });
      expect(result).toBe("<div><strong>Bold</strong></div>");
    });
  });

  describe("Template with Layout", () => {
    it("should render content in layout placeholder", () => {
      // Simulate layout behavior
      const layoutTemplate = Handlebars.compile(
        "<html><body>{{{content}}}</body></html>"
      );
      const contentTemplate = Handlebars.compile("<h1>{{title}}</h1>");

      const content = contentTemplate({ title: "Page Title" });
      const result = layoutTemplate({ content });

      expect(result).toBe("<html><body><h1>Page Title</h1></body></html>");
    });

    it("should pass data to both layout and content", () => {
      const layoutTemplate = Handlebars.compile(
        "<html><head><title>{{subject}}</title></head><body>{{{content}}}</body></html>"
      );
      const contentTemplate = Handlebars.compile(
        "<p>Hello, {{userName}}</p>"
      );

      const data = { subject: "Welcome", userName: "Alice", content: "" };
      data.content = contentTemplate(data);
      const result = layoutTemplate(data);

      expect(result).toContain("<title>Welcome</title>");
      expect(result).toContain("<p>Hello, Alice</p>");
    });
  });

  describe("Partials", () => {
    beforeEach(() => {
      // Register test partials
      Handlebars.registerPartial("header", "<header>{{title}}</header>");
      Handlebars.registerPartial("footer", "<footer>Copyright {{year}}</footer>");
    });

    afterEach(() => {
      Handlebars.unregisterPartial("header");
      Handlebars.unregisterPartial("footer");
    });

    it("should render partials", () => {
      const template = Handlebars.compile(
        "{{> header}}{{> footer}}"
      );
      const result = template({ title: "My Site", year: 2024 });
      expect(result).toBe("<header>My Site</header><footer>Copyright 2024</footer>");
    });

    it("should pass context to partials", () => {
      const template = Handlebars.compile("{{> header title=customTitle}}");
      const result = template({ customTitle: "Custom Header" });
      expect(result).toBe("<header>Custom Header</header>");
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined values gracefully", () => {
      const template = Handlebars.compile("<p>{{missing}}</p>");
      const result = template({});
      expect(result).toBe("<p></p>");
    });

    it("should handle null values", () => {
      const template = Handlebars.compile("<p>{{value}}</p>");
      const result = template({ value: null });
      expect(result).toBe("<p></p>");
    });

    it("should handle empty arrays", () => {
      const template = Handlebars.compile(
        "{{#each items}}{{this}}{{else}}No items{{/each}}"
      );
      const result = template({ items: [] });
      expect(result).toBe("No items");
    });

    it("should handle special characters in data", () => {
      const template = Handlebars.compile("<p>{{text}}</p>");
      const result = template({ text: "Hello & Goodbye <test>" });
      expect(result).toBe("<p>Hello &amp; Goodbye &lt;test&gt;</p>");
    });

    it("should handle unicode characters", () => {
      const template = Handlebars.compile("<p>{{text}}</p>");
      const result = template({ text: "Hello 世界 🌍" });
      expect(result).toBe("<p>Hello 世界 🌍</p>");
    });
  });
});

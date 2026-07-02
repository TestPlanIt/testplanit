import { describe, expect, it } from "vitest";
import {
  isEnvironmentSegment,
  isIssueReferenceSegment,
  normalizeAutomationClassName,
} from "./classNameNormalizer";

describe("classNameNormalizer", () => {
  describe("isEnvironmentSegment", () => {
    it("recognizes browsers (case-insensitive)", () => {
      for (const seg of ["chrome", "Firefox", "msedge", "microsoftedge", "safari"]) {
        expect(isEnvironmentSegment(seg)).toBe(true);
      }
    });

    it("recognizes operating systems including versioned forms", () => {
      for (const seg of ["windows", "macos", "windows10", "win11", "windowsxp", "android13", "ios17"]) {
        expect(isEnvironmentSegment(seg)).toBe(true);
      }
    });

    it("recognizes device models with parenthesized qualifiers", () => {
      for (const seg of [
        "ipadpro11(2024)",
        "iphonese(2020)",
        "ipad(9thgeneration)",
        "ipadair13(2024)",
        "ipadmini(2019)",
      ]) {
        expect(isEnvironmentSegment(seg)).toBe(true);
      }
    });

    it("does not treat real class segments as environment", () => {
      for (const seg of ["com", "Manage_Groups", "SoC_Enabled_Company", "Videos", "AddCommentTest", "Call_Explorer"]) {
        expect(isEnvironmentSegment(seg)).toBe(false);
      }
    });
  });

  describe("isIssueReferenceSegment", () => {
    it("matches single and comma-joined issue refs", () => {
      expect(isIssueReferenceSegment("ADM-18")).toBe(true);
      expect(isIssueReferenceSegment("ABT-11634,_ABT-16279")).toBe(true);
      expect(isIssueReferenceSegment("ADM-2061,_ADM-36")).toBe(true);
    });

    it("does not match class segments that merely contain a ref", () => {
      expect(isIssueReferenceSegment("*_RMAP-374_Descriptive_Messaging_-_Refactored")).toBe(false);
      expect(isIssueReferenceSegment("Manage_Groups")).toBe(false);
    });
  });

  describe("normalizeAutomationClassName", () => {
    it("returns null for empty input", () => {
      expect(normalizeAutomationClassName(null)).toBeNull();
      expect(normalizeAutomationClassName("")).toBeNull();
      expect(normalizeAutomationClassName("...")).toBeNull();
    });

    it("collapses the reported browser variants to one className", () => {
      // RepositoryCases 79775 / 90175 / 90234 / 90370 — same test, four browsers.
      const variants = [
        "chrome.windows.Manage_Groups.ADM-18",
        "msedge.windows10.Manage_Groups.ADM-18",
        "firefox.windows.Manage_Groups.ADM-18",
        "safari.macos.Manage_Groups.ADM-18",
      ];
      for (const folder of variants) {
        expect(normalizeAutomationClassName(folder)).toBe("Manage_Groups");
      }
    });

    it("collapses browser-version prefixes to one className (cases 72691/72695/72697)", () => {
      const variants = [
        "View_User/Group_Log",
        "113_0.windows.View_User/Group_Log",
        "139_0.windows.View_User/Group_Log",
        "16_0.macos.View_User/Group_Log",
        "17_3.macos.View_User/Group_Log",
      ];
      for (const folder of variants) {
        expect(normalizeAutomationClassName(folder)).toBe("View_User/Group_Log");
      }
    });

    it("treats _-separated version numbers as environment but leaves lone numbers", () => {
      expect(isEnvironmentSegment("113_0")).toBe(true);
      expect(isEnvironmentSegment("17_3")).toBe(true);
      expect(isEnvironmentSegment("1000")).toBe(false); // ambiguous lone number — keep
    });

    it("collapses iOS device-model variants to one className", () => {
      const variants = [
        "ios.Videos.Recording.ABT-10329",
        "ios.ipadpro11(2024).Videos.Recording.ABT-11634,_ABT-16279",
        "ios.iphonese(2020).Videos.Recording.ABT-10329",
        "ios.ipad(9thgeneration).Videos.Recording.ABT-11634,_ABT-16279",
      ];
      for (const folder of variants) {
        expect(normalizeAutomationClassName(folder)).toBe("Videos.Recording");
      }
    });

    it("strips trailing issue refs that drift over time", () => {
      expect(normalizeAutomationClassName("chrome.windows.Call_Explorer.ATS-54")).toBe(
        "Call_Explorer"
      );
      expect(
        normalizeAutomationClassName(
          "chrome.windows.*_RMAP-374_Descriptive_Messaging_-_Refactored.ATS-54"
        )
      ).toBe("*_RMAP-374_Descriptive_Messaging_-_Refactored");
    });

    it("strips leading device UDIDs / IPs and interleaved @tags (real android/ios data)", () => {
      // 500+ device addresses per test collapse to one class; issue refs are
      // dropped even when shielded by a trailing @tag.
      const variants = [
        "android.emulator-5554.Basic_Activities.SSO.ABT-12251.@smoke",
        "android.10_101_64_41:16029.Basic_Activities.SSO.ABT-12251.@smoke",
        "android.29291fdh300ej1.Basic_Activities.SSO.ABT-12251.@smoke",
        "ios.00008110-000265383a01401e.Basic_Activities.SSO.ABT-12251.@smoke",
      ];
      for (const folder of variants) {
        expect(normalizeAutomationClassName(folder)).toBe("Basic_Activities.SSO");
      }
    });

    it("drops @realdevice tags in the middle of the path", () => {
      expect(
        normalizeAutomationClassName(
          "ios.00008110-000265383a01401e.Videos.@realdevice.Recording.ABT-11634"
        )
      ).toBe("Videos.Recording");
    });

    it("preserves genuine class paths with no environment prefix", () => {
      // API tests: `com` is not an environment token, so the FQCN is untouched.
      expect(
        normalizeAutomationClassName("com.allego.api.internal.AddCommentTest")
      ).toBe("com.allego.api.internal.AddCommentTest");
    });

    it("keeps distinct suite contexts distinct (does not over-merge)", () => {
      // Same test id can live under two suite contexts; these must NOT collapse.
      expect(normalizeAutomationClassName("chrome.windows.Manage_Groups.ADM-95")).toBe(
        "Manage_Groups"
      );
      expect(
        normalizeAutomationClassName("chrome.windows.SoC_Enabled_Company.ADM-95")
      ).toBe("SoC_Enabled_Company");
    });

    it("never strips away the entire path", () => {
      // Degenerate folder made only of environment tokens still yields identity.
      expect(normalizeAutomationClassName("chrome.windows")).not.toBeNull();
      expect(normalizeAutomationClassName("ios")).toBe("ios");
    });
  });
});

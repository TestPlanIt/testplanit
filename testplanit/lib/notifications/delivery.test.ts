import { describe, expect, it } from "vitest";
import {
  decideNotificationDelivery,
  resolveEffectiveNotificationMode,
} from "./delivery";

describe("resolveEffectiveNotificationMode", () => {
  it("returns an explicit mode as is", () => {
    expect(
      resolveEffectiveNotificationMode(
        { notificationMode: "IN_APP_EMAIL_DAILY" },
        { defaultMode: "NONE" }
      )
    ).toBe("IN_APP_EMAIL_DAILY");
  });

  it("falls through USE_GLOBAL to the admin default", () => {
    expect(
      resolveEffectiveNotificationMode(
        { notificationMode: "USE_GLOBAL" },
        { defaultMode: "IN_APP_EMAIL_IMMEDIATE" }
      )
    ).toBe("IN_APP_EMAIL_IMMEDIATE");
  });

  it("treats a missing preferences row as USE_GLOBAL", () => {
    expect(
      resolveEffectiveNotificationMode(null, { defaultMode: "NONE" })
    ).toBe("NONE");
    expect(resolveEffectiveNotificationMode(undefined, null)).toBe("IN_APP");
  });

  it("defaults the admin setting to IN_APP when unset", () => {
    expect(
      resolveEffectiveNotificationMode({ notificationMode: "USE_GLOBAL" }, {})
    ).toBe("IN_APP");
  });
});

describe("decideNotificationDelivery", () => {
  it("delivers by default with the resolved mode", () => {
    expect(
      decideNotificationDelivery({
        preferences: null,
        globalSettingsValue: { defaultMode: "IN_APP_EMAIL_IMMEDIATE" },
        type: "WORK_ASSIGNED",
      })
    ).toEqual({ deliver: true, mode: "IN_APP_EMAIL_IMMEDIATE" });
  });

  it("drops everything, even a locked type, when the mode is NONE", () => {
    expect(
      decideNotificationDelivery({
        preferences: { notificationMode: "NONE" },
        globalSettingsValue: null,
        type: "INTEGRATION_AUTH_EXPIRED",
      })
    ).toEqual({ deliver: false, mode: "NONE", reason: "mode_none" });
  });

  it("drops a muted optional type", () => {
    expect(
      decideNotificationDelivery({
        preferences: {
          notificationMode: "IN_APP",
          mutedNotificationTypes: ["MILESTONE_DUE_REMINDER"],
        },
        globalSettingsValue: null,
        type: "MILESTONE_DUE_REMINDER",
      })
    ).toEqual({ deliver: false, mode: "IN_APP", reason: "muted" });
  });

  it("ignores a stale muted value for a locked type", () => {
    expect(
      decideNotificationDelivery({
        preferences: {
          notificationMode: "IN_APP",
          mutedNotificationTypes: ["SYSTEM_ANNOUNCEMENT"],
        },
        globalSettingsValue: null,
        type: "SYSTEM_ANNOUNCEMENT",
      })
    ).toEqual({ deliver: true, mode: "IN_APP" });
  });

  it("lets What's New be muted independently of admin broadcasts", () => {
    const preferences = {
      notificationMode: "IN_APP",
      mutedNotificationTypes: ["WHATS_NEW"],
    };
    expect(
      decideNotificationDelivery({
        preferences,
        globalSettingsValue: null,
        type: "WHATS_NEW",
      }).deliver
    ).toBe(false);
    expect(
      decideNotificationDelivery({
        preferences,
        globalSettingsValue: null,
        type: "SYSTEM_ANNOUNCEMENT",
      }).deliver
    ).toBe(true);
  });
});

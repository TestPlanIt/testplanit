import { describe, it, expect, vi } from "vitest";

// Mock the WebSocketStatus enum
vi.mock("@hocuspocus/provider", () => ({
  WebSocketStatus: {
    Connected: "connected",
    Connecting: "connecting",
    Disconnected: "disconnected",
  },
}));

import { getConnectionText } from "./getConnectionText";
import { WebSocketStatus } from "@hocuspocus/provider";

describe("getConnectionText", () => {
  it("should return 'Connected' for Connected status", () => {
    expect(getConnectionText(WebSocketStatus.Connected)).toBe("Connected");
  });

  it("should return 'Connecting...' for Connecting status", () => {
    expect(getConnectionText(WebSocketStatus.Connecting)).toBe("Connecting...");
  });

  it("should return 'Disconnected' for Disconnected status", () => {
    expect(getConnectionText(WebSocketStatus.Disconnected)).toBe(
      "Disconnected"
    );
  });

  it("should return 'Connecting...' for unknown status (default)", () => {
    expect(getConnectionText("unknown" as WebSocketStatus)).toBe(
      "Connecting..."
    );
  });
});

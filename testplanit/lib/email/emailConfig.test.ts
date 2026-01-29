import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isEmailServerConfigured } from "./emailConfig";

describe("isEmailServerConfigured", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh copy of process.env for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original process.env after each test
    process.env = originalEnv;
  });

  it("should return true when all email server environment variables are configured", () => {
    process.env.EMAIL_SERVER_HOST = "smtp.example.com";
    process.env.EMAIL_SERVER_PORT = "587";
    process.env.EMAIL_SERVER_USER = "user@example.com";
    process.env.EMAIL_SERVER_PASSWORD = "password123";
    process.env.EMAIL_FROM = "noreply@example.com";

    expect(isEmailServerConfigured()).toBe(true);
  });

  it("should return false when EMAIL_SERVER_HOST is missing", () => {
    delete process.env.EMAIL_SERVER_HOST;
    process.env.EMAIL_SERVER_PORT = "587";
    process.env.EMAIL_SERVER_USER = "user@example.com";
    process.env.EMAIL_SERVER_PASSWORD = "password123";
    process.env.EMAIL_FROM = "noreply@example.com";

    expect(isEmailServerConfigured()).toBe(false);
  });

  it("should return false when EMAIL_SERVER_PORT is missing", () => {
    process.env.EMAIL_SERVER_HOST = "smtp.example.com";
    delete process.env.EMAIL_SERVER_PORT;
    process.env.EMAIL_SERVER_USER = "user@example.com";
    process.env.EMAIL_SERVER_PASSWORD = "password123";
    process.env.EMAIL_FROM = "noreply@example.com";

    expect(isEmailServerConfigured()).toBe(false);
  });

  it("should return false when EMAIL_SERVER_USER is missing", () => {
    process.env.EMAIL_SERVER_HOST = "smtp.example.com";
    process.env.EMAIL_SERVER_PORT = "587";
    delete process.env.EMAIL_SERVER_USER;
    process.env.EMAIL_SERVER_PASSWORD = "password123";
    process.env.EMAIL_FROM = "noreply@example.com";

    expect(isEmailServerConfigured()).toBe(false);
  });

  it("should return false when EMAIL_SERVER_PASSWORD is missing", () => {
    process.env.EMAIL_SERVER_HOST = "smtp.example.com";
    process.env.EMAIL_SERVER_PORT = "587";
    process.env.EMAIL_SERVER_USER = "user@example.com";
    delete process.env.EMAIL_SERVER_PASSWORD;
    process.env.EMAIL_FROM = "noreply@example.com";

    expect(isEmailServerConfigured()).toBe(false);
  });

  it("should return false when EMAIL_FROM is missing", () => {
    process.env.EMAIL_SERVER_HOST = "smtp.example.com";
    process.env.EMAIL_SERVER_PORT = "587";
    process.env.EMAIL_SERVER_USER = "user@example.com";
    process.env.EMAIL_SERVER_PASSWORD = "password123";
    delete process.env.EMAIL_FROM;

    expect(isEmailServerConfigured()).toBe(false);
  });

  it("should return false when all environment variables are missing", () => {
    delete process.env.EMAIL_SERVER_HOST;
    delete process.env.EMAIL_SERVER_PORT;
    delete process.env.EMAIL_SERVER_USER;
    delete process.env.EMAIL_SERVER_PASSWORD;
    delete process.env.EMAIL_FROM;

    expect(isEmailServerConfigured()).toBe(false);
  });

  it("should return false when environment variables are empty strings", () => {
    process.env.EMAIL_SERVER_HOST = "";
    process.env.EMAIL_SERVER_PORT = "";
    process.env.EMAIL_SERVER_USER = "";
    process.env.EMAIL_SERVER_PASSWORD = "";
    process.env.EMAIL_FROM = "";

    expect(isEmailServerConfigured()).toBe(false);
  });

  it("should return true when environment variables have whitespace but are not empty", () => {
    process.env.EMAIL_SERVER_HOST = " smtp.example.com ";
    process.env.EMAIL_SERVER_PORT = " 587 ";
    process.env.EMAIL_SERVER_USER = " user@example.com ";
    process.env.EMAIL_SERVER_PASSWORD = " password123 ";
    process.env.EMAIL_FROM = " noreply@example.com ";

    expect(isEmailServerConfigured()).toBe(true);
  });
});

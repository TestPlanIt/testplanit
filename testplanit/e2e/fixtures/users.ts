export const users = {
  admin: {
    email: "admin@testplanit.com",
    password: "admin",
    // Add other relevant admin user details if needed (e.g., name, role)
  },
  regular: {
    // Assuming you have a standard test user from the seed data
    email: "testuser@example.com",
    password: "password123",
    // Add other relevant regular user details
  },
  testuser1: {
    email: "testuser1@example.com",
    password: "password123",
  },
  testuser2: {
    email: "testuser2@example.com",
    password: "password123",
  },
  testuser3: {
    email: "testuser3@example.com",
    password: "password123",
  },
  userWithNotifications: {
    email: "userWithNotifications@example.com",
    password: "password123",
  },
  userWithoutNotifications: {
    email: "userWithoutNotifications@example.com",
    password: "password123",
  },
  // Add more user types as needed (e.g., viewer, editor)
  // viewer: {
  //   email: "viewer@testplanit.com",
  //   password: "viewerpassword",
  // },
};

// Optional: Define types for better intellisense and type checking
export type UserRole = keyof typeof users;
export type User = (typeof users)[UserRole];

import { APIRequestContext } from "@playwright/test";

/**
 * Programmatically log in as a user using NextAuth credentials provider.
 * Returns the cookies to set in the browser context for authenticated tests.
 */
export async function loginViaApi(
  request: APIRequestContext,
  email: string,
  password: string
) {
  // 1. Get CSRF token
  const csrfRes = await request.get("/api/auth/csrf");
  if (!csrfRes.ok()) throw new Error("Failed to fetch CSRF token");
  const { csrfToken } = await csrfRes.json();

  // 2. Post credentials to NextAuth credentials callback
  const loginRes = await request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email,
      password,
    },
  });
  if (!loginRes.ok()) throw new Error("Login failed");

  // 3. Return cookies for use in browser context
  const cookies = await request.storageState();
  return cookies;
}

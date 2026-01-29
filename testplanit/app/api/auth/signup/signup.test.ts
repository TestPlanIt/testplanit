import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies using vi.hoisted
const { mockPrisma, mockHash, mockIsEmailServerConfigured } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    registrationSettings: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockHash: vi.fn(),
  mockIsEmailServerConfigured: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: mockPrisma,
}));

vi.mock("bcrypt", () => ({
  hash: mockHash,
}));

vi.mock("~/lib/email/emailConfig", () => ({
  isEmailServerConfigured: mockIsEmailServerConfigured,
}));

// Import the route after mocking
import { POST as signup } from "./route";

describe("POST /api/auth/signup", () => {
  const createRequest = (body: object) => {
    return new NextRequest("http://localhost/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  };

  const validSignupData = {
    name: "Test User",
    email: "test@example.com",
    password: "password123",
    emailVerifToken: "verification-token-123",
    access: "NONE" as const,
    roleId: 1,
  };

  const mockNewUser = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    access: "NONE",
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHash.mockResolvedValue("hashed-password");
    // Default: email server is configured
    mockIsEmailServerConfigured.mockReturnValue(true);
  });

  describe("Email Verification Required (default)", () => {
    beforeEach(() => {
      // Default: requireEmailVerification = true
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        id: "default-settings",
        requireEmailVerification: true,
        restrictEmailDomains: false,
        allowOpenRegistration: true,
        defaultAccess: "NONE",
        force2FANonSSO: false,
        force2FAAllLogins: false,
      });
    });

    it("should create user with emailVerified as null when verification is required", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);

      const response = await signup(createRequest(validSignupData));
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data).toEqual({
        ...mockNewUser,
        createdAt: mockNewUser.createdAt.toISOString(),
      });
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Test User",
          email: "test@example.com",
          password: "hashed-password",
          emailVerifToken: "verification-token-123",
          emailVerified: null,
          access: "NONE",
          roleId: 1,
          isActive: true,
          isDeleted: false,
          authMethod: "INTERNAL",
        }),
        select: expect.any(Object),
      });
    });

    it("should store emailVerifToken when verification is required", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);

      await signup(createRequest(validSignupData));

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          emailVerifToken: "verification-token-123",
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("Email Verification Not Required", () => {
    beforeEach(() => {
      // requireEmailVerification = false
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        id: "default-settings",
        requireEmailVerification: false,
        restrictEmailDomains: false,
        allowOpenRegistration: true,
        defaultAccess: "NONE",
        force2FANonSSO: false,
        force2FAAllLogins: false,
      });
    });

    it("should create user with emailVerified set to current timestamp when verification is not required", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);

      const beforeRequest = new Date();
      const response = await signup(createRequest(validSignupData));
      const afterRequest = new Date();

      expect(response.status).toBe(201);

      // Verify emailVerified is set to a timestamp
      const createCall = mockPrisma.user.create.mock.calls[0][0];
      const emailVerified = createCall.data.emailVerified;

      expect(emailVerified).toBeInstanceOf(Date);
      expect(emailVerified.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
      expect(emailVerified.getTime()).toBeLessThanOrEqual(afterRequest.getTime());
    });

    it("should not store emailVerifToken when verification is not required", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);

      await signup(createRequest(validSignupData));

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          emailVerifToken: null,
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("No Registration Settings (defaults to requiring verification)", () => {
    beforeEach(() => {
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);
    });

    it("should require email verification by default when no settings exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);

      await signup(createRequest(validSignupData));

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          emailVerified: null,
          emailVerifToken: "verification-token-123",
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("Validation and Error Handling", () => {
    beforeEach(() => {
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        requireEmailVerification: true,
      });
    });

    it("should return 400 when user already exists", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "existing-user",
        email: "test@example.com",
      });

      const response = await signup(createRequest(validSignupData));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("User with this email already exists");
    });

    it("should return 400 for invalid email format", async () => {
      const invalidData = {
        ...validSignupData,
        email: "invalid-email",
      };

      const response = await signup(createRequest(invalidData));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("should return 400 for missing required fields", async () => {
      const invalidData = {
        email: "test@example.com",
        // Missing name and password
      };

      const response = await signup(createRequest(invalidData));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("should return 400 for password too short", async () => {
      const invalidData = {
        ...validSignupData,
        password: "123", // Less than 4 characters
      };

      const response = await signup(createRequest(invalidData));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
    });

    it("should handle Prisma unique constraint violation (P2002)", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockRejectedValue({
        code: "P2002",
        meta: { target: ["email"] },
      });

      const response = await signup(createRequest(validSignupData));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("User with this email already exists");
    });

    it("should return 500 on unexpected database error", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockRejectedValue(new Error("Database connection failed"));

      const response = await signup(createRequest(validSignupData));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create user");
    });
  });

  describe("User Preferences Creation", () => {
    beforeEach(() => {
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        requireEmailVerification: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
    });

    it("should create default user preferences during signup", async () => {
      let preferencesCreated = false;

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: vi.fn().mockImplementation((args) => {
              // Check if userPreferences.create is present
              if (args.data.userPreferences?.create) {
                preferencesCreated = true;
                expect(args.data.userPreferences.create).toEqual({
                  itemsPerPage: "P10",
                  dateFormat: "MM_DD_YYYY_DASH",
                  timeFormat: "HH_MM_A",
                  theme: "Light",
                  locale: "en_US",
                });
              }
              return mockNewUser;
            }),
          },
        };
        return callback(tx);
      });

      await signup(createRequest(validSignupData));

      expect(preferencesCreated).toBe(true);
    });
  });

  describe("Password Hashing", () => {
    beforeEach(() => {
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        requireEmailVerification: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
    });

    it("should hash password with bcrypt (10 rounds)", async () => {
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);

      await signup(createRequest(validSignupData));

      expect(mockHash).toHaveBeenCalledWith("password123", 10);
    });

    it("should store hashed password, not plain text", async () => {
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);

      await signup(createRequest(validSignupData));

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          password: "hashed-password",
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("Response Data", () => {
    beforeEach(() => {
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        requireEmailVerification: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            create: mockPrisma.user.create,
          },
        };
        return callback(tx);
      });
      mockPrisma.user.create.mockResolvedValue(mockNewUser);
    });

    it("should return 201 status on successful signup", async () => {
      const response = await signup(createRequest(validSignupData));

      expect(response.status).toBe(201);
    });

    it("should return limited user data (no sensitive fields)", async () => {
      const response = await signup(createRequest(validSignupData));
      const data = await response.json();

      expect(data.data).toEqual({
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        access: "NONE",
        createdAt: expect.any(String),
      });

      // Should NOT include password, emailVerifToken, etc.
      expect(data.data.password).toBeUndefined();
      expect(data.data.emailVerifToken).toBeUndefined();
    });
  });

  describe("Email Server Configuration", () => {
    describe("When email server is NOT configured", () => {
      beforeEach(() => {
        mockIsEmailServerConfigured.mockReturnValue(false);
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            user: {
              create: mockPrisma.user.create,
            },
          };
          return callback(tx);
        });
        mockPrisma.user.create.mockResolvedValue(mockNewUser);
      });

      it("should disable email verification even when registration settings require it", async () => {
        // Settings say requireEmailVerification: true
        mockPrisma.registrationSettings.findFirst.mockResolvedValue({
          id: "default-settings",
          requireEmailVerification: true,
          restrictEmailDomains: false,
          allowOpenRegistration: true,
          defaultAccess: "NONE",
          force2FANonSSO: false,
          force2FAAllLogins: false,
        });

        const beforeRequest = new Date();
        await signup(createRequest(validSignupData));
        const afterRequest = new Date();

        // Should create user with emailVerified set (not null)
        const createCall = mockPrisma.user.create.mock.calls[0][0];
        const emailVerified = createCall.data.emailVerified;

        expect(emailVerified).toBeInstanceOf(Date);
        expect(emailVerified.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
        expect(emailVerified.getTime()).toBeLessThanOrEqual(afterRequest.getTime());
      });

      it("should not store emailVerifToken even when provided", async () => {
        mockPrisma.registrationSettings.findFirst.mockResolvedValue({
          requireEmailVerification: true,
        });

        await signup(createRequest(validSignupData));

        expect(mockPrisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            emailVerifToken: null,
          }),
          select: expect.any(Object),
        });
      });

      it("should work correctly when settings require verification but email server is missing", async () => {
        mockPrisma.registrationSettings.findFirst.mockResolvedValue({
          requireEmailVerification: true,
        });

        const response = await signup(createRequest(validSignupData));

        expect(response.status).toBe(201);
        expect(mockPrisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            emailVerified: expect.any(Date),
            emailVerifToken: null,
          }),
          select: expect.any(Object),
        });
      });

      it("should still work when settings do not require verification", async () => {
        mockPrisma.registrationSettings.findFirst.mockResolvedValue({
          requireEmailVerification: false,
        });

        const response = await signup(createRequest(validSignupData));

        expect(response.status).toBe(201);
        expect(mockPrisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            emailVerified: expect.any(Date),
            emailVerifToken: null,
          }),
          select: expect.any(Object),
        });
      });
    });

    describe("When email server IS configured", () => {
      beforeEach(() => {
        mockIsEmailServerConfigured.mockReturnValue(true);
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            user: {
              create: mockPrisma.user.create,
            },
          };
          return callback(tx);
        });
        mockPrisma.user.create.mockResolvedValue(mockNewUser);
      });

      it("should respect requireEmailVerification setting when true", async () => {
        mockPrisma.registrationSettings.findFirst.mockResolvedValue({
          requireEmailVerification: true,
        });

        await signup(createRequest(validSignupData));

        expect(mockPrisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            emailVerified: null,
            emailVerifToken: "verification-token-123",
          }),
          select: expect.any(Object),
        });
      });

      it("should respect requireEmailVerification setting when false", async () => {
        mockPrisma.registrationSettings.findFirst.mockResolvedValue({
          requireEmailVerification: false,
        });

        await signup(createRequest(validSignupData));

        expect(mockPrisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            emailVerified: expect.any(Date),
            emailVerifToken: null,
          }),
          select: expect.any(Object),
        });
      });
    });
  });
});

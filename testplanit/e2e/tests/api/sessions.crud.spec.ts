import { expect, test } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Sessions CRUD", () => {
  test("should create a session and read it back", async ({
    api,
    request: _request,
    baseURL: _baseURL,
  }) => {
    const sessionName = `API Session ${Date.now()}`;
    let sessionId: number | undefined;

    await test.step("Create a project and session", async () => {
      const projectId = await api.createProject(
        `API Session Create Test Project ${Date.now()}`
      );
      sessionId = await api.createSession(projectId, sessionName);
    });

    await test.step("Read the session back and verify its initial state", async () => {
      const session = await api.getSession(sessionId!);

      expect(session).toBeDefined();
      expect(session.name).toBe(sessionName);
      expect(session.isCompleted).toBe(false);
      expect(session.isDeleted).toBe(false);
    });

    await test.step("Clean up the session", async () => {
      await api.deleteSession(sessionId!);
    });
  });

  test("should update a session name", async ({ api, request, baseURL }) => {
    const originalName = `API Session ${Date.now()}-orig`;
    const newName = `API Session ${Date.now()}-updated`;
    let sessionId: number | undefined;

    await test.step("Create a project and session", async () => {
      const projectId = await api.createProject(
        `API Session Update Test Project ${Date.now()}`
      );
      sessionId = await api.createSession(projectId, originalName);
    });

    await test.step("Update the session name", async () => {
      const updateResponse = await request.patch(
        `${baseURL}/api/model/sessions/update`,
        {
          data: {
            where: { id: sessionId! },
            data: { name: newName },
          },
        }
      );

      expect(updateResponse.ok()).toBe(true);
    });

    await test.step("Verify the session name was updated", async () => {
      const session = await api.getSession(sessionId!);
      expect(session.name).toBe(newName);
    });

    await test.step("Clean up the session", async () => {
      await api.deleteSession(sessionId!);
    });
  });

  test("should mark a session as completed", async ({
    api,
    request,
    baseURL,
  }) => {
    const sessionName = `API Session ${Date.now()}-complete`;
    let sessionId: number | undefined;

    await test.step("Create a project and session", async () => {
      const projectId = await api.createProject(
        `API Session Complete Test Project ${Date.now()}`
      );
      sessionId = await api.createSession(projectId, sessionName);
    });

    await test.step("Mark the session as completed", async () => {
      const completedAt = new Date().toISOString();
      const updateResponse = await request.patch(
        `${baseURL}/api/model/sessions/update`,
        {
          data: {
            where: { id: sessionId! },
            data: {
              isCompleted: true,
              completedAt: completedAt,
            },
          },
        }
      );

      expect(updateResponse.ok()).toBe(true);
    });

    await test.step("Verify the session is marked completed", async () => {
      const session = await api.getSession(sessionId!);
      expect(session.isCompleted).toBe(true);
      expect(session.completedAt).not.toBeNull();
    });

    await test.step("Clean up the session", async () => {
      await api.deleteSession(sessionId!);
    });
  });

  test("should soft-delete a session", async ({ api, request, baseURL }) => {
    const sessionName = `API Session ${Date.now()}-delete`;
    let sessionId: number | undefined;

    await test.step("Create a project and session", async () => {
      const projectId = await api.createProject(
        `API Session Delete Test Project ${Date.now()}`
      );
      sessionId = await api.createSession(projectId, sessionName);
    });

    await test.step("Perform soft-delete explicitly and wait for response", async () => {
      const deleteResponse = await request.patch(
        `${baseURL}/api/model/sessions/update`,
        {
          data: {
            where: { id: sessionId! },
            data: { isDeleted: true },
          },
        }
      );
      expect(deleteResponse.ok()).toBe(true);
    });

    await test.step("Read back and verify soft-deleted", async () => {
      const session = await api.getSession(sessionId!);
      expect(session).toBeDefined();
      expect(session.isDeleted).toBe(true);
    });
  });

  test("should complete full session lifecycle", async ({
    api,
    request,
    baseURL,
  }) => {
    const sessionName = `API Session ${Date.now()}-lifecycle`;
    let sessionId: number | undefined;
    let session: Awaited<ReturnType<typeof api.getSession>> | undefined;

    await test.step("Create a project and session", async () => {
      const projectId = await api.createProject(
        `API Session Lifecycle Test Project ${Date.now()}`
      );
      sessionId = await api.createSession(projectId, sessionName);
    });

    await test.step("Verify initial state (isCompleted=false)", async () => {
      session = await api.getSession(sessionId!);
      expect(session.name).toBe(sessionName);
      expect(session.isCompleted).toBe(false);
      expect(session.isDeleted).toBe(false);
    });

    await test.step("Update name", async () => {
      const updatedName = `${sessionName}-renamed`;
      const updateNameResponse = await request.patch(
        `${baseURL}/api/model/sessions/update`,
        {
          data: {
            where: { id: sessionId! },
            data: { name: updatedName },
          },
        }
      );
      expect(updateNameResponse.ok()).toBe(true);

      session = await api.getSession(sessionId!);
      expect(session.name).toBe(updatedName);
    });

    await test.step("Mark as completed", async () => {
      const completedAt = new Date().toISOString();
      const completeResponse = await request.patch(
        `${baseURL}/api/model/sessions/update`,
        {
          data: {
            where: { id: sessionId! },
            data: {
              isCompleted: true,
              completedAt: completedAt,
            },
          },
        }
      );
      expect(completeResponse.ok()).toBe(true);

      session = await api.getSession(sessionId!);
      expect(session.isCompleted).toBe(true);
      expect(session.completedAt).not.toBeNull();
    });

    await test.step("Soft-delete (use explicit awaited patch for deterministic behavior)", async () => {
      const deleteResponse = await request.patch(
        `${baseURL}/api/model/sessions/update`,
        {
          data: {
            where: { id: sessionId! },
            data: { isDeleted: true },
          },
        }
      );
      expect(deleteResponse.ok()).toBe(true);

      session = await api.getSession(sessionId!);
      expect(session.isDeleted).toBe(true);
    });
  });
});

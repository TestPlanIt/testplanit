import { expect, test } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Sessions CRUD", () => {
  test("should create a session and read it back", async ({ api, request, baseURL }) => {
    const sessionName = `API Session ${Date.now()}`;
    const projectId = await api.createProject(`API Session Create Test Project ${Date.now()}`);
    const sessionId = await api.createSession(projectId, sessionName);

    const session = await api.getSession(sessionId);

    expect(session).toBeDefined();
    expect(session.name).toBe(sessionName);
    expect(session.isCompleted).toBe(false);
    expect(session.isDeleted).toBe(false);

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should update a session name", async ({ api, request, baseURL }) => {
    const originalName = `API Session ${Date.now()}-orig`;
    const newName = `API Session ${Date.now()}-updated`;
    const projectId = await api.createProject(`API Session Update Test Project ${Date.now()}`);
    const sessionId = await api.createSession(projectId, originalName);

    const updateResponse = await request.patch(
      `${baseURL}/api/model/sessions/update`,
      {
        data: {
          where: { id: sessionId },
          data: { name: newName },
        },
      }
    );

    expect(updateResponse.ok()).toBe(true);

    const session = await api.getSession(sessionId);
    expect(session.name).toBe(newName);

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should mark a session as completed", async ({ api, request, baseURL }) => {
    const sessionName = `API Session ${Date.now()}-complete`;
    const projectId = await api.createProject(`API Session Complete Test Project ${Date.now()}`);
    const sessionId = await api.createSession(projectId, sessionName);

    const completedAt = new Date().toISOString();
    const updateResponse = await request.patch(
      `${baseURL}/api/model/sessions/update`,
      {
        data: {
          where: { id: sessionId },
          data: {
            isCompleted: true,
            completedAt: completedAt,
          },
        },
      }
    );

    expect(updateResponse.ok()).toBe(true);

    const session = await api.getSession(sessionId);
    expect(session.isCompleted).toBe(true);
    expect(session.completedAt).not.toBeNull();

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should soft-delete a session", async ({ api, request, baseURL }) => {
    const sessionName = `API Session ${Date.now()}-delete`;
    const projectId = await api.createProject(`API Session Delete Test Project ${Date.now()}`);
    const sessionId = await api.createSession(projectId, sessionName);

    // Perform soft-delete explicitly and wait for response
    const deleteResponse = await request.patch(
      `${baseURL}/api/model/sessions/update`,
      {
        data: {
          where: { id: sessionId },
          data: { isDeleted: true },
        },
      }
    );
    expect(deleteResponse.ok()).toBe(true);

    // Read back and verify soft-deleted
    const session = await api.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session.isDeleted).toBe(true);
  });

  test("should complete full session lifecycle", async ({ api, request, baseURL }) => {
    const sessionName = `API Session ${Date.now()}-lifecycle`;
    const projectId = await api.createProject(`API Session Lifecycle Test Project ${Date.now()}`);
    const sessionId = await api.createSession(projectId, sessionName);

    // Step 1: Verify initial state (isCompleted=false)
    let session = await api.getSession(sessionId);
    expect(session.name).toBe(sessionName);
    expect(session.isCompleted).toBe(false);
    expect(session.isDeleted).toBe(false);

    // Step 2: Update name
    const updatedName = `${sessionName}-renamed`;
    const updateNameResponse = await request.patch(
      `${baseURL}/api/model/sessions/update`,
      {
        data: {
          where: { id: sessionId },
          data: { name: updatedName },
        },
      }
    );
    expect(updateNameResponse.ok()).toBe(true);

    session = await api.getSession(sessionId);
    expect(session.name).toBe(updatedName);

    // Step 3: Mark as completed
    const completedAt = new Date().toISOString();
    const completeResponse = await request.patch(
      `${baseURL}/api/model/sessions/update`,
      {
        data: {
          where: { id: sessionId },
          data: {
            isCompleted: true,
            completedAt: completedAt,
          },
        },
      }
    );
    expect(completeResponse.ok()).toBe(true);

    session = await api.getSession(sessionId);
    expect(session.isCompleted).toBe(true);
    expect(session.completedAt).not.toBeNull();

    // Step 4: Soft-delete (use explicit awaited patch for deterministic behavior)
    const deleteResponse = await request.patch(
      `${baseURL}/api/model/sessions/update`,
      {
        data: {
          where: { id: sessionId },
          data: { isDeleted: true },
        },
      }
    );
    expect(deleteResponse.ok()).toBe(true);

    session = await api.getSession(sessionId);
    expect(session.isDeleted).toBe(true);
  });
});

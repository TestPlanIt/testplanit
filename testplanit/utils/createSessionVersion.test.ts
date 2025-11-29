import { describe, it, expect } from "vitest";
import { createSessionVersion } from "./createSessionVersion";
import { Session } from "next-auth";
import { CompletableSession } from "@/projects/sessions/[projectId]/[sessionId]/CompleteSessionDialog";

// Mock data setup adhering to CompletableSession type
const mockSessionData: CompletableSession = {
  id: 123,
  name: "Test Session Alpha",
  projectId: 456,
  project: { name: "Project Omega" },
  templateId: 789,
  template: {
    id: 789,
    templateName: "Basic Template",
    isDeleted: false,
    isDefault: false,
    isEnabled: true,
  },
  configId: 101,
  configuration: { name: "Default Config" },
  milestoneId: 112,
  milestone: { name: "Phase 1" },
  stateId: 1,
  state: { name: "In Progress" },
  assignedToId: "user-abc",
  assignedTo: { name: "Alice" },
  estimate: 3600, // seconds
  forecastManual: null,
  forecastAutomated: null,
  elapsed: 1800,
  note: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Note content" }] },
    ],
  },
  mission: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Mission details" }],
      },
    ],
  },
  currentVersion: 4,
  tags: JSON.stringify(["urgent", "frontend"]),
  attachments: JSON.stringify([
    { id: "att1", name: "spec.pdf", url: "...", type: "application/pdf" },
  ]),
};

const mockUserSession: Session = {
  user: {
    id: "user-xyz",
    name: "Bob The Builder",
    email: "bob@example.com",
  },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Expires in 1 day
};

describe("createSessionVersion", () => {
  const sessionId = 123;
  const projectId = 456;
  const version = 5;

  it("should map standard fields correctly", async () => {
    const result = await createSessionVersion({
      sessionId,
      projectId,
      sessionData: mockSessionData,
      version,
      session: mockUserSession,
    });

    expect(result.data.session.connect.id).toBe(sessionId);
    expect(result.data.project.connect.id).toBe(projectId);
    expect(result.data.name).toBe(mockSessionData.name);
    expect(result.data.staticProjectId).toBe(projectId);
    expect(result.data.staticProjectName).toBe(mockSessionData.project.name);
    expect(result.data.templateId).toBe(mockSessionData.templateId);
    expect(result.data.templateName).toBe(
      mockSessionData.template.templateName
    );
    expect(result.data.configId).toBe(mockSessionData.configId);
    expect(result.data.configurationName).toBe(
      mockSessionData.configuration?.name
    );
    expect(result.data.milestoneId).toBe(mockSessionData.milestoneId);
    expect(result.data.milestoneName).toBe(mockSessionData.milestone?.name);
    expect(result.data.stateId).toBe(mockSessionData.stateId);
    expect(result.data.stateName).toBe(mockSessionData.state.name);
    expect(result.data.assignedToId).toBe(mockSessionData.assignedToId);
    expect(result.data.assignedToName).toBe(mockSessionData.assignedTo?.name);
    expect(result.data.createdById).toBe(mockUserSession.user.id);
    expect(result.data.createdByName).toBe(mockUserSession.user.name);
    expect(result.data.estimate).toBe(mockSessionData.estimate);
    expect(result.data.elapsed).toBe(mockSessionData.elapsed);
    expect(result.data.note).toBe(JSON.stringify(mockSessionData.note));
    expect(result.data.mission).toBe(JSON.stringify(mockSessionData.mission));
    expect(result.data.version).toBe(version);
    expect(result.data.tags).toBe(mockSessionData.tags);
    expect(result.data.attachments).toBe(mockSessionData.attachments);
    expect(result.data.isCompleted).toBe(false);
    expect(result.data.completedAt).toBeNull();
  });

  it("should handle optional fields being null/undefined correctly", async () => {
    const minimalSessionData: CompletableSession = JSON.parse(
      JSON.stringify(mockSessionData)
    );

    minimalSessionData.configId = null;
    minimalSessionData.configuration = null;
    minimalSessionData.milestoneId = null;
    minimalSessionData.milestone = null;
    minimalSessionData.assignedToId = null;
    minimalSessionData.assignedTo = null;
    minimalSessionData.project = { name: undefined as any };
    minimalSessionData.template = {
      ...mockSessionData.template,
      templateName: null as any,
    };
    minimalSessionData.state = { name: undefined as any };
    minimalSessionData.tags = undefined;
    minimalSessionData.attachments = null as any;

    const minimalUserSession: Session = {
      user: { id: "user-xyz" },
      expires: new Date().toISOString(),
    };

    const result = await createSessionVersion({
      sessionId,
      projectId,
      sessionData: minimalSessionData,
      version,
      session: minimalUserSession,
    });

    expect(result.data.configId).toBeNull();
    expect(result.data.configurationName).toBeNull();
    expect(result.data.milestoneId).toBeNull();
    expect(result.data.milestoneName).toBeNull();
    expect(result.data.assignedToId).toBeNull();
    expect(result.data.assignedToName).toBeNull();
    expect(result.data.staticProjectName).toBe("Unknown Project");
    expect(result.data.templateName).toBe("");
    expect(result.data.stateName).toBe("");
    expect(result.data.createdByName).toBe("Unknown User");
    expect(result.data.tags).toBeUndefined();
    expect(result.data.attachments).toBeNull();
  });

  it("should use provided isCompleted and completedAt values", async () => {
    const completionDate = new Date();
    const result = await createSessionVersion({
      sessionId,
      projectId,
      sessionData: mockSessionData,
      version,
      session: mockUserSession,
      isCompleted: true,
      completedAt: completionDate,
    });

    expect(result.data.isCompleted).toBe(true);
    expect(result.data.completedAt).toBe(completionDate);
  });

  it("should handle null for note and mission", async () => {
    const sessionDataWithNulls: CompletableSession = {
      ...mockSessionData,
      note: null,
      mission: null,
    };
    const result = await createSessionVersion({
      sessionId,
      projectId,
      sessionData: sessionDataWithNulls,
      version,
      session: mockUserSession,
    });

    expect(result.data.note).toBe("null");
    expect(result.data.mission).toBe("null");
  });
});

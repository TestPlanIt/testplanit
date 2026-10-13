import { request as playwrightRequest, type Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * Uploaded-file access: every storage endpoint rejects anonymous callers,
 * signed-in users still get their files, and storage-backed images keep
 * rendering in the browser (they must be fetched by the browser itself, with
 * the session cookie, never through Next's image optimizer).
 */

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const PRESIGN_ENDPOINTS = [
  "/api/get-attachment-url",
  "/api/get-avatar-url",
  "/api/get-docimage-url",
  "/api/get-project-icon-url",
];

const UPLOAD_ENDPOINTS = [
  "/api/upload-attachment",
  "/api/upload-avatar",
  "/api/upload-docimage",
  "/api/upload-project-icon",
];

function pngFile(name = "pixel.png") {
  return { name, mimeType: "image/png", buffer: PNG_BYTES };
}

async function uploadPng(
  page: Page,
  endpoint: string,
  name?: string
): Promise<{ url: string; key: string }> {
  const response = await page.request.post(endpoint, {
    multipart: { file: pngFile(name) },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).success;
}

/** Waits until the image has actually decoded, not just been inserted. */
async function expectImageLoaded(page: Page, src: string) {
  const img = page.locator(`img[src="${src}"]`).first();
  await expect(img).toBeVisible();
  await expect
    .poll(() =>
      img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)
    )
    .toBeGreaterThan(0);
}

test.describe("Storage access", () => {
  // The avatar tests change the shared admin user's image, so run in order.
  test.describe.configure({ mode: "default" });

  test("anonymous callers are rejected by every storage endpoint", async ({
    baseURL,
  }) => {
    const anonymous = await playwrightRequest.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const endpoint of PRESIGN_ENDPOINTS) {
        const response = await anonymous.get(`${endpoint}?prependString=E2E`);
        expect(response.status(), endpoint).toBe(401);
      }
      for (const endpoint of UPLOAD_ENDPOINTS) {
        const response = await anonymous.post(endpoint, {
          multipart: { file: pngFile(), prependString: "E2E" },
        });
        expect(response.status(), endpoint).toBe(401);
      }
      const read = await anonymous.get(
        "/api/storage/uploads/attachments/does-not-matter.png"
      );
      expect(read.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });

  test("a signed-in user can upload and read back a file", async ({ page }) => {
    const { url, key } = await uploadPng(page, "/api/upload-attachment");
    expect(key).toMatch(/^uploads\/attachments\/\d+_pixel\.png$/);

    const response = await page.request.get(url);
    expect(response.status()).toBe(200);
    expect(Buffer.from(await response.body())).toEqual(PNG_BYTES);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["content-disposition"]).toBeUndefined();
  });

  test("uploaded HTML and SVG are served as sandboxed downloads", async ({
    page,
  }) => {
    for (const file of [
      { name: "page.html", mimeType: "text/html" },
      { name: "drawing.svg", mimeType: "image/svg+xml" },
    ]) {
      const upload = await page.request.post("/api/upload-attachment", {
        multipart: {
          file: { ...file, buffer: Buffer.from("<script>1</script>") },
        },
      });
      expect(upload.status()).toBe(200);
      const { url } = (await upload.json()).success;

      const response = await page.request.get(url);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-disposition"], file.name).toBe(
        "attachment"
      );
      expect(response.headers()["content-security-policy"]).toContain(
        "sandbox"
      );
    }
  });

  test("keys outside uploads/ are not served", async ({ page }) => {
    const response = await page.request.get("/api/storage/not-uploads/x.png");
    expect(response.status()).toBe(404);
  });

  test("a storage-backed avatar renders in the header", async ({
    page,
    api,
    adminUserId,
  }) => {
    const { url } = await uploadPng(page, "/api/upload-avatar", "avatar.png");
    await api.updateUser({ userId: adminUserId, data: { image: url } });
    try {
      await page.goto(`/en-US/users/profile/${adminUserId}`);
      await page.waitForLoadState("load");

      const headerAvatar = page.getByTestId("user-menu-trigger").locator("img");
      await expect(headerAvatar).toHaveAttribute("src", url);
      await expectImageLoaded(page, url);
    } finally {
      await api.updateUser({ userId: adminUserId, data: { image: null } });
    }
  });

  test("a storage-backed image attachment renders on the case page", async ({
    page,
    api,
  }) => {
    const { url } = await uploadPng(page, "/api/upload-attachment", "shot.png");
    const projectId = await api.createProject(`Storage ${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Storage attachment ${Date.now()}`
    );
    const userId = await api.getCurrentUserId();

    const create = await page.request.post("/api/model/attachments/create", {
      data: {
        data: {
          url,
          name: "shot.png",
          mimeType: "image/png",
          size: PNG_BYTES.length,
          testCase: { connect: { id: caseId } },
          createdBy: { connect: { id: userId } },
        },
      },
    });
    expect(create.status(), await create.text()).toBeLessThan(300);

    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("load");
    await expectImageLoaded(page, url);
  });

  test("avatar upload through the profile UI renders in proxy mode", async ({
    page,
    api,
    adminUserId,
  }) => {
    await api.updateUser({ userId: adminUserId, data: { image: null } });
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("load");
    const storageMode = await page.evaluate(
      () => (window as { __STORAGE_MODE__?: string }).__STORAGE_MODE__
    );
    test.skip(storageMode !== "proxy", "server is not in proxy storage mode");

    try {
      await page
        .getByRole("button", { name: "Change Profile Picture" })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#file-upload").setInputFiles(pngFile("ui.png"));

      const preview = dialog.getByRole("img", { name: "Preview" });
      await expect(preview).toHaveAttribute(
        "src",
        /^\/api\/storage\/uploads\/avatars\//
      );
      const src = (await preview.getAttribute("src"))!;
      await expectImageLoaded(page, src);

      await dialog.getByRole("button", { name: "Submit" }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByTestId("user-menu-trigger").locator("img")
      ).toHaveAttribute("src", src);
    } finally {
      await api.updateUser({ userId: adminUserId, data: { image: null } });
    }
  });
});

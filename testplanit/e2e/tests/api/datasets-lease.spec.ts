import { expect, test } from "../../fixtures";

/**
 * Shared-dataset row leases: the REST primitives a parameterized runner uses
 * to hand out rows exclusively (acquire, extend, release), on top of the
 * project-level dataset create and save routes.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Dataset row leases", () => {
  test("creates a shared dataset, saves rows, and leases them", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Dataset Lease ${ts}`);
    let dataSetId = 0;

    await test.step("Create the dataset and save two rows", async () => {
      const created = await request.post(
        `${baseURL}/api/projects/${projectId}/datasets`,
        { data: { name: `Lease dataset ${ts}` } }
      );
      expect(created.status()).toBe(200);
      dataSetId = (await created.json()).dataSet.id;

      const saved = await request.post(
        `${baseURL}/api/projects/${projectId}/datasets/${dataSetId}/save`,
        {
          data: {
            parametersJson: [
              { name: "browser", type: "STRING", order: 0 },
              { name: "region", type: "STRING", order: 1 },
            ],
            rowsJson: [
              {
                label: "chrome-eu",
                valuesJson: { browser: "chrome", region: "eu" },
              },
              {
                label: "firefox-us",
                valuesJson: { browser: "firefox", region: "us" },
              },
            ],
          },
        }
      );
      expect(saved.status()).toBe(200);
      const body = await saved.json();
      expect(body.ok).toBe(true);
      expect(body.rowCount).toBe(2);
    });

    let leaseToken = "";
    let rowId = 0;
    await test.step("Acquire a row with a lease token", async () => {
      const res = await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/acquire`,
        { data: { ttlSeconds: 60 } }
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.acquired).toBe(true);
      expect(body.row?.valuesJson).toBeTruthy();
      expect(body.leaseToken).toBeTruthy();
      leaseToken = body.leaseToken;
      rowId = body.row.id;
    });

    await test.step("Extend the lease", async () => {
      const res = await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/${rowId}/extend`,
        { data: { leaseToken, ttlSeconds: 120 } }
      );
      expect(res.status()).toBe(200);
    });

    await test.step("A second acquire hands out the other row", async () => {
      const res = await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/acquire`,
        { data: {} }
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.acquired).toBe(true);
      expect(body.row.id).not.toBe(rowId);
      // Release it straight away so the dataset is left clean.
      await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/${body.row.id}/release`,
        { data: { leaseToken: body.leaseToken } }
      );
    });

    await test.step("Release the first row and acquire it again", async () => {
      const released = await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/${rowId}/release`,
        { data: { leaseToken } }
      );
      expect(released.status()).toBe(200);
      expect((await released.json()).released).toBe(true);

      const again = await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/${rowId}/release`,
        { data: { leaseToken } }
      );
      expect(again.status()).toBe(200);
      expect((await again.json()).released).toBe(false);

      const reacquired = await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/acquire`,
        { data: {} }
      );
      expect((await reacquired.json()).acquired).toBe(true);
    });

    await test.step("Extending an unknown row is a 404", async () => {
      const res = await request.post(
        `${baseURL}/api/datasets/${dataSetId}/rows/999999999/extend`,
        { data: { leaseToken } }
      );
      expect(res.status()).toBe(404);
    });
  });
});

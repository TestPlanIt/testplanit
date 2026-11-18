import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { primaryStickyCookie } from "./replicaConfig";
import {
  requestRoutingInit,
  withPrimaryRequestRouting,
  withRequestRouting,
} from "./requestRouting";
import { getRoutingContext, markWroteInContext } from "./routingContext";

const request = (
  method: string,
  headers: Record<string, string> = {},
  url = "https://tp.example.com/api/things/7?x=1"
) => new Request(url, { method, headers });

/** A handler that reports the frame it ran in. */
const reportFrame = async (_req: Request) => {
  const ctx = getRoutingContext();
  return Response.json({
    framed: ctx !== undefined,
    autoReplica: ctx?.autoReplica,
    forcePrimary: ctx?.forcePrimary,
    label: ctx?.label,
  });
};

describe("requestRouting", () => {
  beforeEach(() => {
    process.env.DATABASE_REPLICA_URLS = "postgresql://replica/db";
  });
  afterEach(() => {
    delete process.env.DATABASE_REPLICA_URLS;
    delete process.env.DATABASE_PRIMARY_STICKY_MS;
  });

  describe("requestRoutingInit", () => {
    it("offloads a browser's GET and HEAD", () => {
      expect(requestRoutingInit(request("GET"))).toEqual({
        autoReplica: true,
        forcePrimary: false,
        label: "GET /api/things/7",
      });
      expect(requestRoutingInit(request("HEAD")).autoReplica).toBe(true);
    });

    it.each(["POST", "PUT", "PATCH", "DELETE"])(
      "keeps a %s on the primary",
      (method) => {
        expect(requestRoutingInit(request(method)).autoReplica).toBe(false);
      }
    );

    it("keeps a Bearer-token read on the primary", () => {
      const init = requestRoutingInit(
        request("GET", { authorization: "Bearer tpi_abc" })
      );
      expect(init.autoReplica).toBe(false);
    });

    it("pins a request that carries the stickiness cookie", () => {
      const init = requestRoutingInit(
        request("GET", { cookie: "theme=dark; tpi_rw_primary=1" })
      );
      expect(init.forcePrimary).toBe(true);
    });

    it("is not fooled by a cookie whose name merely ends the same", () => {
      const init = requestRoutingInit(
        request("GET", { cookie: "not_tpi_rw_primary=1" })
      );
      expect(init.forcePrimary).toBe(false);
    });

    it("ignores the cookie when stickiness is turned off", () => {
      process.env.DATABASE_PRIMARY_STICKY_MS = "0";
      const init = requestRoutingInit(
        request("GET", { cookie: "tpi_rw_primary=1" })
      );
      expect(init.forcePrimary).toBe(false);
    });
  });

  describe("withRequestRouting", () => {
    it("calls the handler with no frame when no replicas are configured", async () => {
      delete process.env.DATABASE_REPLICA_URLS;
      const response = await withRequestRouting(reportFrame)(request("GET"));
      expect(await response.json()).toMatchObject({ framed: false });
    });

    it("runs a GET in an offloading frame labelled with its route", async () => {
      const response = await withRequestRouting(reportFrame)(request("GET"));
      expect(await response.json()).toEqual({
        framed: true,
        autoReplica: true,
        forcePrimary: false,
        label: "GET /api/things/7",
      });
      expect(getRoutingContext()).toBeUndefined();
    });

    it("passes every argument through and returns the handler's response", async () => {
      const handler = async (
        _req: Request,
        context: { params: Promise<{ id: string }> }
      ) => Response.json({ id: (await context.params).id });
      const response = await withRequestRouting(handler)(request("GET"), {
        params: Promise.resolve({ id: "7" }),
      });
      expect(await response.json()).toEqual({ id: "7" });
    });

    it("sets the stickiness cookie when the handler wrote", async () => {
      const handler = async (_req: Request) => {
        markWroteInContext();
        return Response.json({ ok: true });
      };
      const response = await withRequestRouting(handler)(request("POST"));
      expect(response.headers.get("set-cookie")).toBe(
        "tpi_rw_primary=1; Path=/; Max-Age=5; HttpOnly; SameSite=Lax"
      );
    });

    it("sets it for a GET that wrote, too", async () => {
      const handler = async (_req: Request) => {
        markWroteInContext();
        return new Response("ok");
      };
      const response = await withRequestRouting(handler)(request("GET"));
      expect(response.headers.get("set-cookie")).toContain("tpi_rw_primary=1");
    });

    it("sets no cookie when nothing was written", async () => {
      const response = await withRequestRouting(reportFrame)(request("POST"));
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("sets no cookie when stickiness is turned off", async () => {
      process.env.DATABASE_PRIMARY_STICKY_MS = "0";
      const handler = async (_req: Request) => {
        markWroteInContext();
        return Response.json({ ok: true });
      };
      const response = await withRequestRouting(handler)(request("POST"));
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(primaryStickyCookie()).toBeNull();
    });

    it("survives a response whose headers cannot be changed", async () => {
      const handler = async (_req: Request) => {
        markWroteInContext();
        return Response.redirect("https://tp.example.com/done");
      };
      const response = await withRequestRouting(handler)(request("POST"));
      expect(response.status).toBe(302);
    });

    it("calls a handler given no request directly", async () => {
      const handler = async () =>
        Response.json({ framed: !!getRoutingContext() });
      const response = await withRequestRouting(handler)();
      expect(await response.json()).toEqual({ framed: false });
    });
  });

  describe("withPrimaryRequestRouting", () => {
    it("pins a GET's reads to the primary", async () => {
      const response = await withPrimaryRequestRouting(reportFrame)(
        request("GET")
      );
      expect(await response.json()).toMatchObject({
        framed: true,
        autoReplica: false,
        forcePrimary: true,
      });
    });
  });
});

const express = require("express");
const { mount, getMountedRoutes, clearMountedRoutes, extractEndpoints, describe } = require("../src/utils/mount");

describe("mount helper", () => {
  let app;

  beforeEach(() => {
    clearMountedRoutes();
    app = express();
  });

  it("records mounted routes in the registry", () => {
    const router = express.Router();
    router.get("/test", (req, res) => res.json({ ok: true }));

    mount(app, "/api", router, { description: "API routes" });

    const routes = getMountedRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      prefix: "/api",
      description: "API routes",
      kind: "http",
    });
  });

  it("accepts kind option for sse and websocket", () => {
    const router1 = express.Router();
    const router2 = express.Router();

    mount(app, "/stream", router1, { kind: "sse" });
    mount(app, "/ws", router2, { kind: "websocket" });

    const routes = getMountedRoutes();
    expect(routes[0].kind).toBe("sse");
    expect(routes[1].kind).toBe("websocket");
  });

  it("mounts router at prefix (makes routes accessible)", () => {
    const router = express.Router();
    router.get("/test", (req, res) => res.json({ ok: true }));

    mount(app, "/api", router);

    // The route should be accessible
    request(app)
      .get("/api/test")
      .then(res => {
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
      });
  });
});

describe("extractEndpoints", () => {
  let app;

  beforeEach(() => {
    clearMountedRoutes();
    app = express();
  });

  it("extracts endpoints from direct routes", () => {
    app.get("/health", (req, res) => res.json({ status: "ok" }));
    app.get("/api/users", (req, res) => res.json([]));

    const endpoints = extractEndpoints(app);

    expect(endpoints).toContainEqual(expect.objectContaining({
      method: "GET",
      path: "/health",
    }));
    expect(endpoints).toContainEqual(expect.objectContaining({
      method: "GET",
      path: "/api/users",
    }));
  });

  it("extracts endpoints from mounted routers", () => {
    const router = express.Router();
    router.get("/test", (req, res) => res.json({}));

    app.use("/api", router);

    const endpoints = extractEndpoints(app);

    expect(endpoints).toContainEqual(expect.objectContaining({
      method: "GET",
      path: expect.stringContaining("/api"),
    }));
  });

  it("sorts endpoints by path then method", () => {
    app.post("/zebra", (req, res) => res.json({}));
    app.get("/alpha", (req, res) => res.json({}));
    app.get("/zebra", (req, res) => res.json({}));

    const endpoints = extractEndpoints(app);

    expect(endpoints[0].path).toBe("/alpha");
    expect(endpoints[1].path).toBe("/zebra");
    expect(endpoints[1].method).toBe("GET");
    expect(endpoints[2].method).toBe("POST");
  });

  it("prevents duplicates by construction", () => {
    // Mount same router twice with different prefixes
    const router1 = express.Router();
    const router2 = express.Router();

    router1.get("/test", (req, res) => res.json({}));
    router2.get("/test", (req, res) => res.json({}));

    app.use("/api1", router1);
    app.use("/api2", router2);

    const endpoints = extractEndpoints(app);

    // Count occurrences of each unique path
    const paths = endpoints.map(e => `${e.method}:${e.path}`);
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });

  it("includes dynamically added test routes", () => {
    const router = express.Router();

    app.use("/api", router);

    // Add route dynamically after mounting
    router.get("/dynamic", (req, res) => res.json({}));

    const endpoints = extractEndpoints(app);

    expect(endpoints).toContainEqual(expect.objectContaining({
      method: "GET",
      path: expect.stringContaining("/dynamic"),
    }));
  });

  it("handles nested prefix composition", () => {
    const nestedRouter = express.Router();
    nestedRouter.get("/deep", (req, res) => res.json({}));

    const apiRouter = express.Router();
    apiRouter.use("/v1", nestedRouter);

    app.use("/api", apiRouter);

    const endpoints = extractEndpoints(app);

    expect(endpoints).toContainEqual(expect.objectContaining({
      method: "GET",
      path: expect.stringContaining("/deep"),
    }));
  });
});

describe("describe marker", () => {
  it("adds description to request for later retrieval", () => {
    const mw = describe("Get user by ID", { kind: "http" });
    const req = {};
    const res = {};
    const next = jest.fn();

    mw(req, res, next);

    expect(req.routeDescription).toBe("Get user by ID");
    expect(req.routeKind).toBe("http");
    expect(next).toHaveBeenCalled();
  });

  it("defaults kind to http", () => {
    const mw = describe("Some route");
    const req = {};
    const res = {};
    const next = jest.fn();

    mw(req, res, next);

    expect(req.routeKind).toBe("http");
  });

  it("accepts sse kind", () => {
    const mw = describe("Event stream", { kind: "sse" });
    const req = {};
    const res = {};
    const next = jest.fn();

    mw(req, res, next);

    expect(req.routeKind).toBe("sse");
  });
});
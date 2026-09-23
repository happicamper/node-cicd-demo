const request = require("supertest");
const app = require("./server");
const { version: pkgVersion } = require("./package.json");

describe("GET /", () => {
  test("responds with 200 and the expected payload shape", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Hello from Secure CI/CD!",
      version: pkgVersion,
    });
  });
});

describe("GET /version", () => {
  test("responds with the package.json version when no build-time value is set", async () => {
    const res = await request(app).get("/version");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: require("./package.json").version,
      commit: "unknown",
    });
  });
});

describe("GET /health", () => {
  test("responds with 200 and status healthy", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "healthy" });
  });
});

describe("GET /search", () => {
  test("echoes the query parameter back", async () => {
    const res = await request(app).get("/search").query({ q: "ecs" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Search request received",
      query: "ecs",
    });
  });

  test("returns query: undefined-equivalent when q is omitted", async () => {
    const res = await request(app).get("/search");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Search request received");
    expect(res.body.query).toBeUndefined();
  });
});

describe("Unmatched routes (404 handler)", () => {
  test("returns a JSON 404, not Express's default HTML error page", async () => {
    const res = await request(app).get("/this-route-does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not Found" });
  });
});

describe("Security headers", () => {
  test("sets Helmet's default protective headers on a normal route", async () => {
    const res = await request(app).get("/");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'self'"
    );
  });

  test("sets the custom Permissions-Policy header", async () => {
    const res = await request(app).get("/");

    expect(res.headers["permissions-policy"]).toBe(
      "geolocation=(), microphone=(), camera=(), payment=(), usb=()"
    );
  });

  // Regression test: the DAST full-scan job (ZAP rule 10055) once caught
  // Express's built-in finalhandler overwriting Helmet's CSP with
  // `default-src 'none'` on any unmatched route, silently dropping the
  // frame-ancestors / base-uri / form-action directives that don't fall
  // back to default-src. The custom 404 handler in server.js fixes this
  // by never letting a request reach finalhandler. This test pins that
  // fix in place so a future refactor can't reintroduce the bug without
  // a red test — the class of issue that a header-diff scan like ZAP
  // would otherwise be the only thing to catch, and only after deploy.
  test("404 responses still carry the full CSP, not finalhandler's default-src 'none'", async () => {
    const res = await request(app).get("/robots.txt");

    expect(res.status).toBe(404);
    const csp = res.headers["content-security-policy"];
    expect(csp).not.toBe("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
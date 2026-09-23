const express = require("express");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    // Be explicit about the directives with no fallback to default-src,
    // rather than relying on Helmet's defaults holding on every route
    // (including error/404 responses).
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);

// Helmet does not set this header by default — app-specific by design.
// Locking every feature down is a safe default for an API with no
// browser-facing UI; loosen individual entries if you add one later.
app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=()"
  );
  next();
});

app.use(express.json());

// Falls back to package.json's version for local dev / tests, where no
// build-time value is injected. In a deployed container, APP_VERSION and
// GIT_SHA come from the Docker build args set in ci-cd.yml.
const { version: pkgVersion } = require("./package.json");
const APP_VERSION = process.env.APP_VERSION || pkgVersion;
const GIT_SHA = process.env.GIT_SHA || "unknown";

app.get("/", (req, res) => {
  res.json({
    message: "Hello from Secure CI/CD!",
    version: APP_VERSION
  });
});

app.get("/version", (req, res) => {
  res.json({
    version: APP_VERSION,
    commit: GIT_SHA
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy"
  });
});

app.get("/search", (req, res) => {
  const query = req.query.q;

  res.json({
    message: "Search request received",
    query: query
  });
});

// Catch-all for unmatched routes. Without this, Express falls through to
// its built-in finalhandler, which sets its own Content-Security-Policy
// (default-src 'none') on the generated error page — overwriting Helmet's
// policy rather than adding to it, since finalhandler runs after Helmet
// in the request lifecycle for any route with no match.
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Only start listening when run directly (`node server.js`), not when
// required by a test file — otherwise every test run tries to bind a
// real port.
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Application running on port ${PORT}`);
  });
}

module.exports = app;
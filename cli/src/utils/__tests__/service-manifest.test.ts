// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generatedFieldErrorsForFile,
  getInvalidServiceRoutePathFields,
  SERVICE_MANIFEST_SCHEMA_URL,
  SERVICE_MANIFEST_SCHEMA_VERSION,
  validateGeneratedStringFields,
  validateServiceManifest,
  validateServiceManifestFile,
} from "../service-manifest.js";

function manifestBase(): Record<string, unknown> {
  return {
    appName: "api",
    appType: "backend",
    stack: "shop",
    schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
  };
}

describe("service manifest compatibility", () => {
  it("rejects non-object, null, and array manifests", () => {
    expect(validateServiceManifest(null, "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest(undefined, "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest("raw-string", "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest(12345, "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest([], "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
  });

  it("requires schema version and reports missing required fields by path", () => {
    const result = validateServiceManifest({}, "services/shop/api/service.json");
    expect(result.errors).toEqual([
      "services/shop/api/service.json.appName: required field is missing",
      "services/shop/api/service.json.appType: required field is missing",
      "services/shop/api/service.json.stack: required field is missing",
      "services/shop/api/service.json.schemaVersion: required field is missing",
    ]);
  });

  it("reports required fields that are not strings", () => {
    const result = validateServiceManifest(
      {
        appName: 123,
        appType: null,
        stack: "shop",
        schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      },
      "service.json",
    );
    expect(result.errors).toEqual([
      "service.json.appName: expected a string",
      "service.json.appType: expected a string",
    ]);
  });

  it("warns about extra fields while retaining their values", () => {
    const manifest = {
      appName: "api",
      appType: "backend",
      stack: "shop",
      schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      customerMetadata: { owner: "team-a" },
    };
    const result = validateServiceManifest(manifest, "service.json");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["service.json.customerMetadata: unknown field is preserved"]);
    expect(result.manifest?.customerMetadata).toEqual({ owner: "team-a" });
  });

  it("accepts all known service manifest fields without unknown warnings", () => {
    const allKnown = {
      $schema: SERVICE_MANIFEST_SCHEMA_URL,
      agent: { model: "default" },
      apiBasePath: "/api/v1",
      apiPath: "/api",
      appName: "full-service",
      appType: "backend",
      backendName: "flisk-core",
      basePath: "/base",
      build: { context: "." },
      buildContext: "./build",
      databaseName: "shop_db",
      dependencies: ["dep-svc"],
      dev: { liveReload: false },
      dependsOn: ["dep-svc"],
      dockerfile: "Dockerfile",
      enabled: true,
      exposeViaProxy: true,
      featuresEnabled: ["tracing"],
      framework: "fastapi",
      healthCheckPath: "/health",
      image: "ghcr.io/org/repo:tag",
      language: "python",
      name: "full-service",
      nats: { queueGroup: "q_group" },
      params: { ENV_VAR: "1" },
      playwright: { timeout: 5000 },
      port: 8080,
      replicas: 1,
      restart: "always",
      runtime: "docker",
      sablier: { sessionDuration: "5m" },
      schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      secrets: ["DB_PASSWORD"],
      smoke: { via: "proxy", steps: [{ path: "/health", expect: 200 }] },
      stack: "shop",
      syncs: [{ host: "./src", container: "/app" }],
      traefik: { host: "shop.local", pathPrefix: "/api", healthCheck: "/health" },
      type: "service",
    };

    const result = validateServiceManifest(allKnown, "service.json");
    expect(result.errors).toEqual([]);
    // Only deprecation warnings should be present, no "unknown field" warnings
    const unknownWarnings = result.warnings.filter((w) => w.includes("unknown field"));
    expect(unknownWarnings).toEqual([]);
  });

  it("accepts a smoke block without calling it unknown, and reports a bad one as an error by path", () => {
    const base = manifestBase();
    const good = validateServiceManifest(
      { ...base, smoke: { via: "proxy", steps: [{ path: "/records", expect: 200 }] } },
      "service.json",
    );
    expect(good.errors).toEqual([]);
    expect(good.warnings).toEqual([]);

    const bad = validateServiceManifest(
      { ...base, smoke: { via: "container", steps: [{ path: "records" }] } },
      "service.json",
    );
    expect(bad.errors.join("\n")).toMatch(/service\.json\.smoke\.via/);
    expect(bad.errors.join("\n")).toMatch(/service\.json\.smoke\.steps\[0\]\.path/);
  });

  it("accepts dev.liveReload as a boolean and reports anything else as an error by path", () => {
    const base = manifestBase();
    const ok = validateServiceManifest(
      { ...base, language: "go", dev: { liveReload: true } },
      "service.json",
    );
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);

    const bad = validateServiceManifest(
      { ...base, language: "go", dev: { liveReload: "yes" } },
      "service.json",
    );
    expect(bad.errors.join("\n")).toMatch(/service\.json\.dev\.liveReload: expected true or false/);

    const badNumber = validateServiceManifest(
      { ...base, language: "go", dev: { liveReload: 1 } },
      "service.json",
    );
    expect(badNumber.errors.join("\n")).toMatch(
      /service\.json\.dev\.liveReload: expected true or false/,
    );
  });

  it("ignores dev when it is null or not an object", () => {
    const base = manifestBase();
    const resultNull = validateServiceManifest({ ...base, dev: null }, "service.json");
    expect(resultNull.errors).toEqual([]);

    const resultString = validateServiceManifest({ ...base, dev: "not-an-object" }, "service.json");
    expect(resultString.errors).toEqual([]);
  });

  it("warns that dev.liveReload only applies to Go services", () => {
    const base = manifestBase();
    const result = validateServiceManifest(
      { ...base, language: "python", dev: { liveReload: true } },
      "service.json",
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/service\.json\.dev\.liveReload: .*only .*Go/);

    // false does not warn for non-Go services
    const resultFalse = validateServiceManifest(
      { ...base, language: "python", dev: { liveReload: false } },
      "service.json",
    );
    expect(resultFalse.warnings).toEqual([]);
  });

  it("warns specifically that a jwtSecret in service.json is ignored and must not be committed", () => {
    const result = validateServiceManifest(
      {
        ...manifestBase(),
        jwtSecret: "committed-by-mistake",
      },
      "service.json",
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("service.json.jwtSecret");
    expect(result.warnings[0]).toMatch(/ignored/);
    expect(result.warnings[0]).toContain("JWT_SECRET");
    expect(result.warnings[0]).not.toContain("committed-by-mistake");
  });

  it("flags the deprecated dependencies and envVars fields, and says what replaces them", () => {
    const result = validateServiceManifest(
      {
        ...manifestBase(),
        dependencies: ["orders"],
        envVars: { LOG_LEVEL: "debug" },
      },
      "service.json",
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      "service.json.dependencies: deprecated, use dependsOn (still read for now)",
      "service.json.envVars: deprecated, use params (still read when params is absent)",
    ]);
    expect(result.manifest?.dependencies).toEqual(["orders"]);
    expect(result.manifest?.envVars).toEqual({ LOG_LEVEL: "debug" });
  });

  it("does not flag the current fields", () => {
    const result = validateServiceManifest(
      {
        ...manifestBase(),
        dependsOn: ["orders"],
        params: { LOG_LEVEL: "debug" },
      },
      "service.json",
    );
    expect(result.warnings).toEqual([]);
  });

  describe("getInvalidServiceRoutePathFields", () => {
    it("returns empty array for non-objects or arrays", () => {
      expect(getInvalidServiceRoutePathFields(null)).toEqual([]);
      expect(getInvalidServiceRoutePathFields(undefined)).toEqual([]);
      expect(getInvalidServiceRoutePathFields([])).toEqual([]);
      expect(getInvalidServiceRoutePathFields("string")).toEqual([]);
      expect(getInvalidServiceRoutePathFields(123)).toEqual([]);
    });

    it("returns empty array when fields are valid strings or absent", () => {
      expect(getInvalidServiceRoutePathFields({})).toEqual([]);
      expect(getInvalidServiceRoutePathFields({ apiPath: "/api" })).toEqual([]);
      expect(getInvalidServiceRoutePathFields({ basePath: "/base" })).toEqual([]);
      expect(getInvalidServiceRoutePathFields({ apiPath: "/api", basePath: "/base" })).toEqual([]);
    });

    it("returns field names when fields are not strings", () => {
      expect(getInvalidServiceRoutePathFields({ apiPath: 42 })).toEqual(["apiPath"]);
      expect(getInvalidServiceRoutePathFields({ basePath: null })).toEqual(["basePath"]);
      expect(getInvalidServiceRoutePathFields({ apiPath: true, basePath: {} })).toEqual([
        "apiPath",
        "basePath",
      ]);
    });
  });

  it("validates route path overrides as strings", () => {
    const base = manifestBase();
    const valid = validateServiceManifest(
      { ...base, apiPath: "/api/v2", basePath: "/web" },
      "services/shop/api/service.json",
    );
    expect(valid.errors).toEqual([]);
    expect(valid.warnings).toEqual([]);

    const invalid = validateServiceManifest(
      { ...base, apiPath: 42, basePath: null },
      "services/shop/api/service.json",
    );
    expect(invalid.errors).toEqual([
      "services/shop/api/service.json.apiPath: expected a string",
      "services/shop/api/service.json.basePath: expected a string",
    ]);
    expect(invalid.warnings).toEqual([]);
  });

  it("rejects unsupported schema versions", () => {
    const result = validateServiceManifest({ ...manifestBase(), schemaVersion: 2 }, "service.json");
    expect(result.errors).toEqual([
      "service.json.schemaVersion: unsupported version 2 (supported: 1)",
    ]);
  });

  describe("validateGeneratedStringFields", () => {
    it("accepts valid generated string fields", () => {
      const manifest = {
        healthCheckPath: "/health/v1-status",
        traefik: {
          host: "shop.backend.my-project.local",
          pathPrefix: "/api/v1/shop-management",
          healthCheck: "/ping",
        },
        nats: { queueGroup: "shop_backend.group-1" },
        databaseName: "shop_db-2",
        stack: "shop-stack_prod",
        image: "ghcr.io/acme/app:1.0@sha256:abc123def",
      };
      expect(validateGeneratedStringFields(manifest, "service.json")).toEqual([]);
    });

    it("treats null, undefined, and empty string as unset", () => {
      const manifest = {
        healthCheckPath: "",
        traefik: { host: null, pathPrefix: undefined, healthCheck: "" },
        nats: { queueGroup: null },
        databaseName: "",
        stack: undefined,
        image: null,
      };
      expect(validateGeneratedStringFields(manifest, "service.json")).toEqual([]);
    });

    it("reports non-string types for generated fields", () => {
      const manifest = {
        healthCheckPath: 123,
        traefik: { host: true, pathPrefix: ["/path"] },
        nats: { queueGroup: {} },
        databaseName: false,
        image: 99,
      };
      const errors = validateGeneratedStringFields(manifest, "service.json");
      expect(errors).toContain("service.json.healthCheckPath: expected a string");
      expect(errors).toContain("service.json.traefik.host: expected a string");
      expect(errors).toContain("service.json.traefik.pathPrefix: expected a string");
      expect(errors).toContain("service.json.nats.queueGroup: expected a string");
      expect(errors).toContain("service.json.databaseName: expected a string");
      expect(errors).toContain("service.json.image: expected a string");
    });

    it("reports specific pattern requirements without echoing dangerous values", () => {
      const invalidFields: Array<[Record<string, unknown>, string, string]> = [
        [{ healthCheckPath: "health" }, "healthCheckPath", "a path such as /health"],
        [
          { traefik: { host: "host:8080" } },
          "traefik.host",
          "a hostname such as shop.backend.myproject.local",
        ],
        [
          { traefik: { pathPrefix: "api/v1" } },
          "traefik.pathPrefix",
          "a path such as /api/v1/shop-management",
        ],
        [{ traefik: { healthCheck: "health" } }, "traefik.healthCheck", "a path such as /health"],
        [
          { nats: { queueGroup: "queue with spaces" } },
          "nats.queueGroup",
          "letters, digits, '_', '.' or '-'",
        ],
        [{ databaseName: "db.dot" }, "databaseName", "letters, digits, '_' or '-'"],
        [{ stack: "stack.with.dots" }, "stack", "letters, digits, '_' or '-'"],
        [
          { image: "image with spaces" },
          "image",
          "an image reference such as ghcr.io/acme/app:1.0",
        ],
      ];

      for (const [partial, fieldName, patternHint] of invalidFields) {
        const errors = validateGeneratedStringFields(partial, "service.json");
        expect(
          errors.some((e) => e.startsWith(`service.json.${fieldName}: must be ${patternHint}`)),
          `Failed for field ${fieldName}`,
        ).toBe(true);
      }
    });

    it("detects control characters in nested object keys and array values", () => {
      const manifestWithBadKey = {
        "root\nkey": "value",
        nested: {
          "nested\rkey": "value",
        },
      };
      const keyErrors = validateGeneratedStringFields(manifestWithBadKey, "service.json");
      expect(keyErrors).toContain("service.json: a key contains a line break");
      expect(keyErrors).toContain("service.json.nested: a key contains a line break");

      const manifestWithUnicodeControls = {
        params: {
          del: "val\x7f",
          nel: "val\x85",
          lineSep: "val\u2028",
          parSep: "val\u2029",
          nul: "val\x00",
        },
      };
      const controlErrors = validateGeneratedStringFields(
        manifestWithUnicodeControls,
        "service.json",
      );
      expect(controlErrors.length).toBe(5);
      for (const err of controlErrors) {
        expect(err).toContain("must not contain line breaks or control characters");
      }
    });
  });

  describe("validateServiceManifestFile and generatedFieldErrorsForFile", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "service-manifest-file-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("reports missing file in validateServiceManifestFile", () => {
      const missing = join(dir, "nonexistent.json");
      expect(validateServiceManifestFile(missing, "nonexistent.json")).toEqual({
        errors: ["nonexistent.json: file is missing"],
        warnings: [],
      });
    });

    it("reports invalid JSON syntax in validateServiceManifestFile", () => {
      const invalid = join(dir, "broken.json");
      writeFileSync(invalid, "{ invalid json content");
      const result = validateServiceManifestFile(invalid, "broken.json");
      expect(result.errors[0]).toContain("broken.json: invalid JSON (");
      expect(result.warnings).toEqual([]);
    });

    it("validates a well-formed service.json file", () => {
      const file = join(dir, "service.json");
      writeFileSync(file, JSON.stringify(manifestBase()));
      const result = validateServiceManifestFile(file, "service.json");
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.manifest?.appName).toBe("api");
    });

    it("generatedFieldErrorsForFile returns empty array for missing or unparseable files", () => {
      expect(generatedFieldErrorsForFile(join(dir, "missing.json"), "missing.json")).toEqual([]);

      const broken = join(dir, "broken.json");
      writeFileSync(broken, "not json");
      expect(generatedFieldErrorsForFile(broken, "broken.json")).toEqual([]);

      const arrayJson = join(dir, "array.json");
      writeFileSync(arrayJson, "[1, 2, 3]");
      expect(generatedFieldErrorsForFile(arrayJson, "array.json")).toEqual([]);
    });

    it("generatedFieldErrorsForFile returns errors for files with hostile values", () => {
      const hostileFile = join(dir, "hostile.json");
      writeFileSync(
        hostileFile,
        JSON.stringify({ ...manifestBase(), healthCheckPath: "/health\ninjection: true" }),
      );
      const errors = generatedFieldErrorsForFile(hostileFile, "hostile.json");
      expect(errors).toContain(
        "hostile.json.healthCheckPath: must be a path such as /health (no spaces, line breaks or YAML syntax)",
      );
    });
  });
});

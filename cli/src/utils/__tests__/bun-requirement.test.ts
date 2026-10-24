// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { DiscoveredResource } from "../../types/index.js";
import { projectNeedsBun } from "../bun-requirement.js";

function resource(appType: string | undefined, name = "svc"): DiscoveredResource {
  return {
    name,
    configPath: `/projects/demo/${name}/service.json`,
    config: { appType },
  } as DiscoveredResource;
}

describe("projectNeedsBun", () => {
  it("needs Bun for frontend and worker services", () => {
    expect(projectNeedsBun([resource("frontend")])).toBe(true);
    expect(projectNeedsBun([resource("worker")])).toBe(true);
  });

  it("needs Bun for backend, mcp, and agent API services", () => {
    expect(projectNeedsBun([resource("backend")])).toBe(true);
    expect(projectNeedsBun([resource("mcp")])).toBe(true);
    expect(projectNeedsBun([resource("agent")])).toBe(true);
  });

  it("does not need Bun when resources array is empty", () => {
    expect(projectNeedsBun([])).toBe(false);
  });

  it("does not need Bun for non-JS or unmanaged service types", () => {
    const nonBunTypes = [
      "bring-your-own",
      "migrator",
      "sdk",
      "library",
      "database",
      "redis",
      undefined,
      "",
    ];
    for (const appType of nonBunTypes) {
      expect(projectNeedsBun([resource(appType)])).toBe(false);
    }
  });

  it("handles mixed projects where at least one service needs Bun", () => {
    const mixedWithoutBun = [
      resource("bring-your-own", "legacy-python"),
      resource("database", "db"),
      resource("library", "shared-types"),
    ];
    expect(projectNeedsBun(mixedWithoutBun)).toBe(false);

    const mixedWithBun = [...mixedWithoutBun, resource("backend", "orders-api")];
    expect(projectNeedsBun(mixedWithBun)).toBe(true);
  });

  it("handles resource missing config property gracefully", () => {
    const resWithoutConfig = {
      name: "bare-res",
      configPath: "/path/service.json",
    } as unknown as DiscoveredResource;
    expect(projectNeedsBun([resWithoutConfig])).toBe(false);
  });
});

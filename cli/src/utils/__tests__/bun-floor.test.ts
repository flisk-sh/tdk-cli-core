// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { MIN_BUN_VERSION, versionMeetsMinimum } from "../../commands/doctor.js";
import { BUN_FLOOR_LABEL, bunMeetsFloor } from "../bun-floor.js";

describe("bunMeetsFloor", () => {
  it.each([
    "1.2.0",
    "v1.2.0",
    "1.2.1",
    "1.2.9",
    "1.3.0",
    "1.10.0",
    "1.20.5",
    "2.0.0",
    "2.1.0",
    "1.2",
    "1.2.0-canary.1",
    "1.2.1-beta.2",
  ])("accepts version %s", (version) => {
    expect(bunMeetsFloor(version)).toBe(true);
  });

  it.each([
    "1.1.9",
    "1.1.10",
    "1.0.0",
    "0.9.0",
    "0.12.0",
    "",
    "   ",
    "canary",
    "not a version",
    "1",
  ])("rejects version %j", (version) => {
    expect(bunMeetsFloor(version)).toBe(false);
  });

  it("handles multi-digit minor versions correctly (e.g. 1.10 is newer than 1.2)", () => {
    expect(bunMeetsFloor("1.10.0")).toBe(true);
    expect(bunMeetsFloor("1.1.10")).toBe(false);
  });

  it("is the same answer flisk doctor gives for every version, because it uses doctor's floor", () => {
    for (const version of [
      "1.1.9",
      "1.2.0",
      "1.2.1",
      "1.10.0",
      "2.0.0",
      "3.0.0",
      "",
      "x",
      "1.1.99",
      "1.2.0-rc.1",
    ]) {
      expect(bunMeetsFloor(version)).toBe(versionMeetsMinimum(version, MIN_BUN_VERSION));
    }
  });

  it("labels the floor the way the preflight message always has", () => {
    expect(BUN_FLOOR_LABEL).toBe(`${MIN_BUN_VERSION[0]}.${MIN_BUN_VERSION[1]}+`);
    expect(BUN_FLOOR_LABEL).toBe("1.2+");
  });
});

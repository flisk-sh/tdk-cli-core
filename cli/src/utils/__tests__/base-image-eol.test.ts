// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../engine");

// Every base image line the engine may build on, with its end-of-life date (YYYY-MM-DD).
// Keys are release lines (`alpine:<major>.<minor>`, `node:<major>-alpine`); versioned references such as
// `node:22.12-alpine` or `alpine:3.22.1` are normalized to their line before the lookup.
// To add a line: find its EOL on the vendor's schedule and add it here, in the same change that uses it.
const BASE_IMAGE_EOL: Record<string, string> = {
  "alpine:3.22": "2027-05-01",
  "node:22-alpine": "2027-04-30",
};

// Alpine: `alpine:3.22`, `alpine:3.22.1`. Node: `node:22-alpine`, `node:22.12-alpine`, `node:22.12.3-alpine`,
// and Alpine-pinned variants such as `node:22-alpine3.22`.
const BASE_IMAGE_REF =
  /\b(?:alpine:(\d+\.\d+)(?:\.\d+)?|node:(\d+)(?:\.\d+){0,2}-alpine(?:\d+(?:\.\d+)*)?)\b/g;

function baseImageRefs(text: string): string[] {
  return [...text.matchAll(BASE_IMAGE_REF)].map(([, alpine, nodeMajor]) =>
    alpine ? `alpine:${alpine}` : `node:${nodeMajor}-alpine`,
  );
}

function engineBaseImageRefs(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const rel of readdirSync(ENGINE_DIR, { recursive: true }) as string[]) {
    if (!rel.endsWith(".star")) continue;
    for (const ref of baseImageRefs(readFileSync(join(ENGINE_DIR, rel), "utf8"))) {
      refs.set(ref, [...(refs.get(ref) ?? []), rel]);
    }
  }
  return refs;
}

function refsWithoutEolEntry(refs: Iterable<string>, eol: Record<string, string>): string[] {
  return [...refs].filter((ref) => !(ref in eol));
}

function refsPastEol(refs: Iterable<string>, eol: Record<string, string>, today: string): string[] {
  return [...refs].filter((ref) => ref in eol && eol[ref] < today);
}

describe("base image end-of-life", () => {
  it("every base image referenced in engine/ has an EOL entry", () => {
    const refs = engineBaseImageRefs();
    const unknown = refsWithoutEolEntry(refs.keys(), BASE_IMAGE_EOL);
    const message = unknown.map((ref) => `${ref} (in ${refs.get(ref)?.join(", ")})`).join("\n");
    expect(unknown, `Base images with no EOL entry:\n${message}`).toEqual([]);
  });

  it("no base image referenced in engine/ is past its end-of-life date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const expired = refsPastEol(engineBaseImageRefs().keys(), BASE_IMAGE_EOL, today).map(
      (ref) => `${ref} reached end of life ${BASE_IMAGE_EOL[ref]}`,
    );
    expect(expired, expired.join("\n")).toEqual([]);
  });

  it("the engine references at least one Alpine and one Node Alpine image", () => {
    const refs = [...engineBaseImageRefs().keys()];
    expect(refs.some((ref) => ref.startsWith("alpine:"))).toBe(true);
    expect(refs.some((ref) => ref.startsWith("node:"))).toBe(true);
  });
});

describe("base image reference scan", () => {
  it.each([
    ["FROM node:22-alpine", ["node:22-alpine"]],
    ["FROM node:22.12-alpine", ["node:22-alpine"]],
    ["FROM node:22.12.3-alpine", ["node:22-alpine"]],
    ["FROM node:22-alpine3.22", ["node:22-alpine"]],
    ["FROM node:22.12-alpine3.22", ["node:22-alpine"]],
    ['"node:22.12-alpine@sha256:0a7108bf"', ["node:22-alpine"]],
    ["FROM alpine:3.22", ["alpine:3.22"]],
    ["FROM alpine:3.22.1", ["alpine:3.22"]],
    ["FROM alpine:3.21.0", ["alpine:3.21"]],
    ["FROM node:20-alpine", ["node:20-alpine"]],
    ["FROM node:18.19.0-alpine", ["node:18-alpine"]],
    ["FROM oven/bun:1.3.11-alpine", []],
    ["FROM node:22-slim", []],
    ["FROM debian:bookworm", []],
    ["FROM ubuntu:24.04", []],
    ["# just a comment without images", []],
  ])("%s -> %j", (text, expected) => {
    expect(baseImageRefs(text)).toEqual(expected);
  });

  it("extracts multiple base image references in multi-stage builds", () => {
    const multiStage = `
      FROM node:22.12-alpine AS builder
      WORKDIR /app
      RUN npm run build

      FROM alpine:3.22.1 AS runner
      COPY --from=builder /app/dist /dist
    `;
    expect(baseImageRefs(multiStage)).toEqual(["node:22-alpine", "alpine:3.22"]);
  });

  it("checks versioned references against EOL table", () => {
    const refs = baseImageRefs("FROM node:20.11-alpine");
    expect(refsWithoutEolEntry(refs, BASE_IMAGE_EOL)).toEqual(["node:20-alpine"]);
    expect(refsPastEol(refs, { "node:20-alpine": "2026-04-30" }, "2026-10-16")).toEqual([
      "node:20-alpine",
    ]);
  });

  it("correctly handles EOL boundary dates", () => {
    const schedule = {
      "alpine:3.20": "2025-11-01",
      "alpine:3.21": "2026-05-01",
      "alpine:3.22": "2027-05-01",
    };

    // On exact EOL date, it is not yet expired (< comparison)
    expect(refsPastEol(["alpine:3.21"], schedule, "2026-05-01")).toEqual([]);

    // One day after EOL date, it is expired
    expect(refsPastEol(["alpine:3.21"], schedule, "2026-05-02")).toEqual(["alpine:3.21"]);

    // Before EOL date, it is valid
    expect(refsPastEol(["alpine:3.22"], schedule, "2026-05-02")).toEqual([]);
  });

  it("detects when all base image references have valid EOL entries", () => {
    const refs = ["alpine:3.22", "node:22-alpine"];
    expect(refsWithoutEolEntry(refs, BASE_IMAGE_EOL)).toEqual([]);
  });

  it("identifies multiple undocumented base image references", () => {
    const refs = ["alpine:3.18", "alpine:3.19", "node:16-alpine"];
    expect(refsWithoutEolEntry(refs, BASE_IMAGE_EOL)).toEqual([
      "alpine:3.18",
      "alpine:3.19",
      "node:16-alpine",
    ]);
  });
});

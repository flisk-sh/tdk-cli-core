// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureExit } from "../../test-support/index.js";
import type { CheckResult } from "../../types/index.js";
import { WEBCONTAINER_DOCS, WEBCONTAINER_UP_MESSAGE } from "../../utils/agent-host.js";
import { CONTAINER_RUNTIME_CHECK } from "../../utils/constants.js";
import { checkHostPorts } from "../../utils/doctor-runtime.js";
import {
  checkBun,
  checkDockerOperatingSystem,
  checkPublishedBindAddress,
  checkTilt,
  checkWslProjectLocation,
  type DoctorCheckFn,
  doctorCommand,
  formatDoctorSummary,
  getDoctorOutcomeMessage,
  isContainerDependentCheck,
  MIN_BUN_VERSION,
  MIN_TILT_VERSION,
  NATIVE_WINDOWS_DOCTOR_MESSAGE,
  orderDoctorResults,
  requiresContainerRuntime,
  runChecks,
  versionMeetsMinimum,
} from "../doctor.js";

vi.mock("../../utils/windows-doctor.js", () => ({
  checkWindowsRuntimeTools: vi.fn(() => ({
    name: "Windows Runtime Tools",
    didPass: true,
    message: "Docker and Tilt found on PATH",
  })),
  checkWindowsDockerMode: vi.fn(() => ({
    name: "Docker container mode",
    didPass: true,
    message: "Docker Desktop is using Linux containers",
  })),
  checkWindowsHostConfiguration: vi.fn(async () => ({
    name: "Windows ports and DNS",
    didPass: true,
    message: "Required ports are available and Flisk localhost DNS resolves to loopback",
  })),
}));

describe("doctor environment contract", () => {
  it("requires Tilt 0.25.0 or newer", async () => {
    expect(MIN_TILT_VERSION).toEqual([0, 25, 0]);
    expect(versionMeetsMinimum("v0.24.9", MIN_TILT_VERSION)).toBe(false);
    expect(versionMeetsMinimum("Tilt v0.25.0", MIN_TILT_VERSION)).toBe(true);
    expect(versionMeetsMinimum("v0.37.7", MIN_TILT_VERSION)).toBe(true);

    const old = await checkTilt(async () => "v0.24.9");
    const current = await checkTilt(async () => "v0.25.0");
    expect(old.didPass).toBe(false);
    expect(old.fix).toContain("Tilt v0.25.0 or newer");
    expect(current.didPass).toBe(true);
  });

  it("requires Bun 1.2+ when a project has generated JavaScript services", async () => {
    expect(MIN_BUN_VERSION).toEqual([1, 2, 0]);
    const root = mkdtempSync(join(tmpdir(), "flisk-doctor-bun-floor-"));
    const originalCwd = process.cwd();
    try {
      mkdirSync(join(root, ".flisk"), { recursive: true });
      mkdirSync(join(root, "services", "api"), { recursive: true });
      writeFileSync(
        join(root, ".flisk", "project.json"),
        JSON.stringify({ project: { name: "test" } }),
      );
      writeFileSync(
        join(root, "services", "api", "service.json"),
        JSON.stringify({ appName: "api", appType: "backend", stack: "app", port: 4000 }),
      );
      process.chdir(root);

      const old = await checkBun(async () => "1.1.9");
      const current = await checkBun(async () => "1.2.0");
      expect(old.didPass).toBe(false);
      expect(old.message).toContain("below the required 1.2.0 floor");
      expect(current.didPass).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips the Bun requirement when the project has no generated JavaScript services", async () => {
    const root = mkdtempSync(join(tmpdir(), "flisk-doctor-no-bun-"));
    const originalCwd = process.cwd();
    try {
      mkdirSync(join(root, ".flisk"), { recursive: true });
      writeFileSync(
        join(root, ".flisk", "project.json"),
        JSON.stringify({ project: { name: "test" } }),
      );
      process.chdir(root);
      const result = await checkBun(async () => {
        throw new Error("Bun should not be checked");
      });
      expect(result.didPass).toBe(true);
      expect(result.isSkipped).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when Docker uses a non-Linux engine", async () => {
    const result = await checkDockerOperatingSystem(async () => "windows");
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("requires Linux containers");
  });

  it("warns when FLISK_BIND_ADDRESS exposes dev ports to the network (GHSA-3hj3-f39v-j2x5)", () => {
    const unset = checkPublishedBindAddress({});
    const loopback = checkPublishedBindAddress({ FLISK_BIND_ADDRESS: "127.0.0.1" });
    const lan = checkPublishedBindAddress({ FLISK_BIND_ADDRESS: "192.168.1.20" });
    const wildcard = checkPublishedBindAddress({ FLISK_BIND_ADDRESS: "0.0.0.0" });
    const wildcardStrict = checkPublishedBindAddress({ FLISK_BIND_ADDRESS: "0.0.0.0" }, true);

    expect(unset.didPass).toBe(true);
    expect(unset.message).toContain("127.0.0.1");
    expect(loopback.didPass).toBe(true);
    expect(lan.didPass).toBe(true);
    expect(wildcard.didPass).toBe(true);
    expect(wildcard.isWarning).toBe(true);
    expect(wildcard.message).toContain("reachable from other machines");
    expect(wildcard.fix).toContain("Unset FLISK_BIND_ADDRESS");
    expect(wildcardStrict.didPass).toBe(false);
  });

  it("treats every IPv6 unspecified spelling as a wildcard bind", () => {
    for (const address of [
      "::",
      "[::]",
      "0:0:0:0:0:0:0:0",
      "[0:0::0]",
      "::0.0.0.0",
      "[::0.0.0.0]",
    ]) {
      const result = checkPublishedBindAddress({ FLISK_BIND_ADDRESS: address }, true);
      expect(result.didPass, address).toBe(false);
    }
    expect(checkPublishedBindAddress({ FLISK_BIND_ADDRESS: "::1" }).isWarning).toBeFalsy();
  });

  it("warns about /mnt/c and fails there only in strict WSL mode", () => {
    const warning = checkWslProjectLocation("/mnt/c/Users/dev/flisk", false, true);
    const strict = checkWslProjectLocation("/mnt/c/Users/dev/flisk", true, true);
    const healthy = checkWslProjectLocation("/home/dev/flisk", true, true);

    expect(warning.didPass).toBe(true);
    expect(warning.isWarning).toBe(true);
    expect(warning.message).toContain("hot reload may be broken");
    expect(strict.didPass).toBe(false);
    expect(strict.fix).toContain("~/projects");
    expect(healthy.didPass).toBe(true);
  });

  it("prints the host 5432 failure before other failures and before passing statuses", () => {
    const checks: CheckResult[] = [
      { name: "Tilt CLI", didPass: false, message: "Tilt is too old", fix: "Update Tilt" },
      { name: "Container Runtime", didPass: true, message: "Docker is running" },
      {
        name: "Host Ports",
        didPass: false,
        message: "Ports Flisk needs are taken:\n    5432 (Postgres) is used by a program",
        fix: "Stop local Postgres",
      },
    ];

    expect(orderDoctorResults(checks).map((check) => check.name)).toEqual([
      "Host Ports",
      "Tilt CLI",
      "Container Runtime",
    ]);
  });

  it("puts Postgres port 5432 first in the host-port failure details", async () => {
    const result = await checkHostPorts((() => "") as never, "flisk-project", async (port) =>
      port === 80 || port === 5432 ? "in-use" : "free",
    );

    expect(result.didPass).toBe(false);
    expect(result.message.indexOf("5432 (Postgres)")).toBeLessThan(
      result.message.indexOf("80 (HTTP)"),
    );
  });

  it("refuses native Windows doctor with WSL2 guidance, diagnostics, and exit code 1", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const { exit } = captureExit();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      await expect(doctorCommand.parseAsync(["node", "doctor"], { from: "node" })).rejects.toThrow(
        "process.exit",
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith(NATIVE_WINDOWS_DOCTOR_MESSAGE);
      expect(NATIVE_WINDOWS_DOCTOR_MESSAGE).toContain("WSL2 Ubuntu");
      expect(NATIVE_WINDOWS_DOCTOR_MESSAGE).toContain("docs/wsl2.md");
      const text = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain(NATIVE_WINDOWS_DOCTOR_MESSAGE);
      expect(text).toContain("Docker Desktop is using Linux containers");
      expect(text).toContain("Required ports are available");
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    doctorCommand.setOptionValue("json", false);
    doctorCommand.setOptionValue("all", false);
    doctorCommand.setOptionValue("ping", true);
    doctorCommand.setOptionValue("pingTimeout", "3000");
    doctorCommand.setOptionValue("strict", false);
    doctorCommand.setOptionValue("fix", false);
    doctorCommand.setOptionValue("dryRun", false);
    doctorCommand.setOptionValue("scope", "project");
    doctorCommand.setOptionValue("yes", false);
  });

  it("enforces CLI flag constraints for --scope, --dry-run, and --yes in text mode", async () => {
    const cases = [
      {
        args: ["--scope", "invalid", "--fix"],
        expectedError: '--scope must be project or machine, got "invalid"',
      },
      {
        args: ["--scope", "machine"],
        expectedError: "--scope only applies with --fix",
      },
      {
        args: ["--dry-run"],
        expectedError: "--dry-run only applies with --fix",
      },
      {
        args: ["--yes"],
        expectedError: "--yes only applies with --fix",
      },
    ];

    for (const { args, expectedError } of cases) {
      const { exit } = captureExit();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await expect(doctorCommand.parseAsync(args, { from: "user" })).rejects.toThrow(
          "process.exit",
        );
        expect(exit).toHaveBeenCalledWith(2);
        expect(errorSpy).toHaveBeenCalledWith(expectedError);
      } finally {
        exit.mockRestore();
        errorSpy.mockRestore();
        logSpy.mockRestore();
        doctorCommand.setOptionValue("fix", false);
        doctorCommand.setOptionValue("dryRun", false);
        doctorCommand.setOptionValue("scope", "project");
        doctorCommand.setOptionValue("yes", false);
      }
    }
  });

  it("refuses WebContainers with clear documentation and exit code 1", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const { exit } = captureExit();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const versions = process.versions as Record<string, string | undefined>;
    const prevWebContainer = versions.webcontainer;
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
      versions.webcontainer = "1";

      await expect(doctorCommand.parseAsync([], { from: "user" })).rejects.toThrow("process.exit");
      expect(exit).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(WEBCONTAINER_UP_MESSAGE);
      expect(WEBCONTAINER_UP_MESSAGE).toContain(WEBCONTAINER_DOCS);
    } finally {
      if (prevWebContainer !== undefined) {
        versions.webcontainer = prevWebContainer;
      } else {
        delete versions.webcontainer;
      }
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      exit.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("cascades container runtime failure to dependent checks in runChecks", async () => {
    const runtimeFailure: DoctorCheckFn = () => ({
      name: CONTAINER_RUNTIME_CHECK,
      didPass: false,
      message: "Docker daemon not running",
    });

    let composeCalled = false;
    const composeCheck: DoctorCheckFn = requiresContainerRuntime("Docker Compose", () => {
      composeCalled = true;
      return { name: "Docker Compose", didPass: true, message: "Docker Compose v2.20" };
    });

    let osCheckCalled = false;
    const checkDockerOperatingSystem: DoctorCheckFn = () => {
      osCheckCalled = true;
      return { name: "Docker OS", didPass: true, message: "Linux engine" };
    };

    let bunCalled = false;
    const bunCheck: DoctorCheckFn = () => {
      bunCalled = true;
      return { name: "Bun CLI", didPass: true, message: "Bun 1.2.0 installed" };
    };

    expect(isContainerDependentCheck(composeCheck)).toBe(true);
    expect(isContainerDependentCheck(checkDockerOperatingSystem)).toBe(true);
    expect(isContainerDependentCheck(bunCheck)).toBe(false);

    const results = await runChecks(
      [runtimeFailure, composeCheck, checkDockerOperatingSystem, bunCheck],
      { all: true },
    );

    expect(composeCalled).toBe(false);
    expect(osCheckCalled).toBe(false);
    expect(bunCalled).toBe(true);

    expect(results).toHaveLength(4);
    expect(results[0].name).toBe(CONTAINER_RUNTIME_CHECK);
    expect(results[0].didPass).toBe(false);

    expect(results[1].name).toBe("Docker Compose");
    expect(results[1].didPass).toBe(true);
    expect(results[1].isSkipped).toBe(true);
    expect(results[1].message).toContain("Docker not running - skipped Docker Compose check");

    expect(results[2].name).toBe("Docker OS");
    expect(results[2].didPass).toBe(true);
    expect(results[2].isSkipped).toBe(true);
    expect(results[2].message).toContain("Docker not running - skipped Docker OS check");

    expect(results[3].name).toBe("Bun CLI");
    expect(results[3].didPass).toBe(true);
    expect(results[3].isSkipped).toBeFalsy();
  });

  it("formats doctor summary and outcome message under all combinations", () => {
    expect(
      formatDoctorSummary([
        { name: "C1", didPass: true, message: "ok" },
        { name: "C2", didPass: true, message: "ok" },
        { name: "C3", didPass: false, message: "fail" },
        { name: "C4", didPass: true, isSkipped: true, message: "skip" },
      ]),
    ).toBe("2 passed, 1 failed, 1 skipped");

    expect(
      formatDoctorSummary([
        { name: "C1", didPass: true, message: "ok" },
        { name: "C2", didPass: true, isWarning: true, message: "warn" },
        { name: "C3", didPass: false, message: "fail" },
        { name: "C4", didPass: true, isSkipped: true, message: "skip" },
      ]),
    ).toBe("1 passed, 1 warned, 1 failed, 1 skipped");

    expect(getDoctorOutcomeMessage(true, true)).toBe("Doctor passed. Next: flisk up");
    expect(getDoctorOutcomeMessage(true, false)).toBe(
      "Doctor failed. Fix the items above, then run: flisk doctor",
    );
    expect(getDoctorOutcomeMessage(false, true)).toBe("Doctor passed. Next: flisk project example");
    expect(getDoctorOutcomeMessage(false, false)).toBe(
      "Doctor failed. Fix the items above, then run: flisk doctor",
    );
  });
});

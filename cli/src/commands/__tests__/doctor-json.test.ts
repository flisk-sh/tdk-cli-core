// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureExit, type ExitCapture, parseEnvelope } from "../../test-support/index.js";
import type { CheckResult } from "../../types/index.js";
import { WEBCONTAINER_DOCS, WEBCONTAINER_UP_MESSAGE } from "../../utils/agent-host.js";
import { type DoctorAction, hasFailedActions } from "../../utils/doctor-fix.js";
import {
  collectDoctorChecks,
  createDoctorReport,
  getDoctorExitCode,
} from "../../utils/doctor-report.js";
import { getHostPortPlan } from "../../utils/host-port-config.js";
import { EnvUnreadableError, envSecretValues } from "../../utils/secret-redaction.js";
import {
  checkWindowsDockerMode,
  checkWindowsHostConfiguration,
  checkWindowsRuntimeTools,
} from "../../utils/windows-doctor.js";
import { doctorCommand, NATIVE_WINDOWS_DOCTOR_MESSAGE } from "../doctor.js";

vi.mock("../../utils/secret-redaction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/secret-redaction.js")>();
  return {
    ...actual,
    envSecretValues: vi.fn(actual.envSecretValues),
  };
});

vi.mock("../../utils/doctor-report.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/doctor-report.js")>();
  return {
    ...actual,
    collectDoctorChecks: vi.fn(actual.collectDoctorChecks),
  };
});

vi.mock("../../utils/host-port-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/host-port-config.js")>();
  return {
    ...actual,
    getHostPortPlan: vi.fn(actual.getHostPortPlan),
  };
});

vi.mock("../../utils/windows-doctor.js", () => ({
  checkWindowsRuntimeTools: vi.fn(() => ({
    name: "Windows Runtime Tools",
    didPass: true,
    message:
      "Docker (C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe) and Tilt found on PATH",
  })),
  checkWindowsDockerMode: vi.fn(() => ({
    name: "Docker container mode",
    didPass: false,
    message:
      "Docker Desktop is using Windows containers. Switch to Linux containers. Flisk stacks are Linux images.",
    fix: "Switch Docker Desktop to Linux containers. Flisk does not run Windows containers.",
  })),
  checkWindowsHostConfiguration: vi.fn(async () => ({
    name: "Windows ports and DNS",
    didPass: false,
    message:
      "Windows did not resolve *.flisk.localhost to 127.0.0.1. Browser URLs with hostnames will fail until you fix hosts or use the 127.0.0.1 URLs printed by flisk networks.\nAdd these lines to C:\\Windows\\System32\\drivers\\etc\\hosts (Administrator Notepad):\n127.0.0.1 flisk.localhost\n127.0.0.1 example.flisk.localhost\ngit core.autocrlf is true; generated files may get CRLF while Docker Linux containers expect LF. Recommended: git config core.autocrlf input in Flisk repos.\nDocker Desktop Settings → Resources → File sharing must include this project directory.",
    fix: "Windows did not resolve *.flisk.localhost to 127.0.0.1. Browser URLs with hostnames will fail until you fix hosts or use the 127.0.0.1 URLs printed by flisk networks.",
  })),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(envSecretValues).mockReturnValue([]);
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

function captureOutput(): { log: ReturnType<typeof vi.spyOn>; exit: ExitCapture["exit"] } {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { exit } = captureExit();
  return { log, exit };
}

const PASSING_CHECK: CheckResult = {
  name: "Container Runtime",
  didPass: true,
  message: "Docker daemon is running",
};

const FAILING_CHECK: CheckResult = {
  name: "Tilt CLI",
  didPass: false,
  message: "Tilt CLI not found",
  fix: "curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash",
};

const SKIPPED_CHECK: CheckResult = {
  name: "Service Health",
  didPass: true,
  isSkipped: true,
  message: "Skipped (--no-ping)",
};

describe("doctor JSON command", () => {
  it.each(["0", "-1", "1.5", "10ms", "NaN", "9007199254740992"])(
    "reports invalid timeout %s without probes",
    async (timeout) => {
      const { log, exit } = captureOutput();
      await expect(
        doctorCommand.parseAsync(["--json", "--ping-timeout", timeout], { from: "user" }),
      ).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(2);
      expect(log).toHaveBeenCalledTimes(1);
      const report = parseEnvelope(String(log.mock.calls[0]?.[0]));
      expect(report.schemaVersion).toBe(1);
      expect(report.data.ready).toBe(false);
      expect(report.data.checks).toEqual([]);
      expect(report.errors[0].code).toBe("USAGE");
    },
  );

  it("uses the same invalid-timeout exit for text mode", async () => {
    const { log, exit } = captureOutput();
    await expect(
      doctorCommand.parseAsync(["--ping-timeout", "0"], { from: "user" }),
    ).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(2);
    expect(log).not.toHaveBeenCalled();
  });

  it("reports native Windows as a blocking finding with Windows diagnostics in data.checks", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("Missing process.platform descriptor");
    const { log, exit } = captureOutput();
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      await expect(doctorCommand.parseAsync(["--json"], { from: "user" })).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(checkWindowsRuntimeTools).toHaveBeenCalledOnce();
      expect(checkWindowsDockerMode).toHaveBeenCalledOnce();
      expect(checkWindowsHostConfiguration).toHaveBeenCalledOnce();

      const rawStdout = String(log.mock.calls[0]?.[0]);
      expect(rawStdout).not.toContain("Flisk Doctor");
      expect(rawStdout).not.toContain("Checking environment...");
      expect(rawStdout).not.toMatch(/[🔍✓✗○⚠]/u);

      const report = parseEnvelope(rawStdout);
      expect(report.data.ready).toBe(false);
      expect(report.data.checks[0].name).toBe("Native Windows support");
      expect(report.data.checks[0].message).toBe(NATIVE_WINDOWS_DOCTOR_MESSAGE);
      expect(report.data.checks[0].fix).toContain("WSL2 Ubuntu");
      expect(report.data.checks.map((check: CheckResult) => check.name)).toEqual([
        "Native Windows support",
        "Windows Runtime Tools",
        "Docker container mode",
        "Windows ports and DNS",
      ]);
      expect(report.data.checks[2].message).toContain("Windows containers");
      expect(report.data.checks[3].message).toContain("flisk.localhost");
      expect(report.data.checks[3].message).toContain("core.autocrlf");
      expect(report.data.host).toMatchObject({ kind: "native-windows", canUp: false });
      expect(report.errors).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("preserves passing, failing (with fix), and skipped check fields in createDoctorReport", () => {
    const failingReport = createDoctorReport([PASSING_CHECK, FAILING_CHECK, SKIPPED_CHECK], true);
    const parsedFailing = JSON.parse(JSON.stringify(failingReport));
    expect(parsedFailing.data.ready).toBe(false);
    expect(parsedFailing.data.checks).toEqual([
      {
        name: "Container Runtime",
        didPass: true,
        message: "Docker daemon is running",
      },
      {
        name: "Tilt CLI",
        didPass: false,
        message: "Tilt CLI not found",
        fix: "curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash",
      },
      {
        name: "Service Health",
        didPass: true,
        isSkipped: true,
        message: "Skipped (--no-ping)",
      },
    ]);
    expect(getDoctorExitCode(failingReport)).toBe(1);

    const passingReport = createDoctorReport([PASSING_CHECK, SKIPPED_CHECK], true);
    const parsedPassing = JSON.parse(JSON.stringify(passingReport));
    expect(parsedPassing.data.ready).toBe(true);
    expect(parsedPassing.data.checks).toEqual([PASSING_CHECK, SKIPPED_CHECK]);
    expect(getDoctorExitCode(passingReport)).toBe(0);
  });

  it("emits a single JSON document on Linux without human banners and matches text mode exit code 1 on failure", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("Missing process.platform descriptor");
    vi.mocked(getHostPortPlan).mockResolvedValue({
      ingressHttp: 80,
      ingressHttps: 443,
      postgres: 5432,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "preferred", ingressHttps: "preferred", postgres: "preferred" },
    });
    vi.mocked(collectDoctorChecks).mockResolvedValue({
      checks: [PASSING_CHECK, FAILING_CHECK, SKIPPED_CHECK],
      errors: [],
    });

    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

      const jsonRun = captureOutput();
      await expect(
        doctorCommand.parseAsync(["--json", "--no-ping"], { from: "user" }),
      ).rejects.toThrow("exit");
      expect(jsonRun.exit).toHaveBeenCalledWith(1);
      expect(jsonRun.log).toHaveBeenCalledTimes(1);

      const rawStdout = String(jsonRun.log.mock.calls[0]?.[0]);
      expect(rawStdout).not.toContain("Flisk Doctor");
      expect(rawStdout).not.toContain("Checking environment...");
      expect(rawStdout).not.toMatch(/[🔍✓✗○⚠]/u);

      const parsed = JSON.parse(rawStdout);
      const report = parseEnvelope(rawStdout);
      expect(parsed).toEqual(report);
      expect(report.data.ready).toBe(false);
      // Failing checks are ordered before passing and skipped checks by orderDoctorResults
      expect(report.data.checks).toEqual([FAILING_CHECK, PASSING_CHECK, SKIPPED_CHECK]);
      expect(report.errors).toEqual([]);

      jsonRun.log.mockRestore();
      jsonRun.exit.mockRestore();
      doctorCommand.setOptionValue("json", false);
      doctorCommand.setOptionValue("ping", true);

      const textRun = captureOutput();
      await expect(doctorCommand.parseAsync(["--no-ping"], { from: "user" })).rejects.toThrow(
        "exit",
      );
      expect(textRun.exit).toHaveBeenCalledWith(1);
      const textLines = textRun.log.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
      expect(textLines).toContain("Flisk Doctor");
      expect(textLines).toContain("Checking environment...");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("exits 0 in both --json and text mode when all non-skipped checks pass", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("Missing process.platform descriptor");
    vi.mocked(getHostPortPlan).mockResolvedValue({
      ingressHttp: 80,
      ingressHttps: 443,
      postgres: 5432,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "preferred", ingressHttps: "preferred", postgres: "preferred" },
    });
    vi.mocked(collectDoctorChecks).mockResolvedValue({
      checks: [PASSING_CHECK, SKIPPED_CHECK],
      errors: [],
    });

    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

      const jsonRun = captureOutput();
      await doctorCommand.parseAsync(["--json", "--no-ping"], { from: "user" });
      expect(jsonRun.exit).not.toHaveBeenCalled();
      expect(jsonRun.log).toHaveBeenCalledTimes(1);

      const rawStdout = String(jsonRun.log.mock.calls[0]?.[0]);
      expect(rawStdout).not.toContain("Flisk Doctor");
      expect(rawStdout).not.toContain("Checking environment...");
      const report = parseEnvelope(rawStdout);
      expect(report.data.ready).toBe(true);
      expect(report.data.checks).toEqual([PASSING_CHECK, SKIPPED_CHECK]);

      jsonRun.log.mockRestore();
      jsonRun.exit.mockRestore();
      doctorCommand.setOptionValue("json", false);
      doctorCommand.setOptionValue("ping", true);

      const textRun = captureOutput();
      await doctorCommand.parseAsync(["--no-ping"], { from: "user" });
      expect(textRun.exit).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("reports invalid --scope, --dry-run, and --yes in JSON envelope with USAGE code", async () => {
    const cases = [
      {
        args: ["--json", "--scope", "cluster", "--fix"],
        expectedError: '--scope must be project or machine, got "cluster"',
      },
      {
        args: ["--json", "--scope", "machine"],
        expectedError: "--scope only applies with --fix",
      },
      {
        args: ["--json", "--dry-run"],
        expectedError: "--dry-run only applies with --fix",
      },
      {
        args: ["--json", "--yes"],
        expectedError: "--yes only applies with --fix",
      },
    ];

    for (const { args, expectedError } of cases) {
      const { log, exit } = captureOutput();
      try {
        await expect(doctorCommand.parseAsync(args, { from: "user" })).rejects.toThrow("exit");
        expect(exit).toHaveBeenCalledWith(2);
        expect(log).toHaveBeenCalledTimes(1);
        const report = parseEnvelope(String(log.mock.calls[0]?.[0]));
        expect(report.schemaVersion).toBe(1);
        expect(report.data.ready).toBe(false);
        expect(report.data.checks).toEqual([]);
        expect(report.errors[0]).toEqual({ code: "USAGE", message: expectedError });
      } finally {
        log.mockRestore();
        exit.mockRestore();
        doctorCommand.setOptionValue("fix", false);
        doctorCommand.setOptionValue("dryRun", false);
        doctorCommand.setOptionValue("scope", "project");
        doctorCommand.setOptionValue("yes", false);
      }
    }
  });

  it("handles Commander unknown options with USAGE JSON report via exitOverride", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { log, exit } = captureOutput();
    try {
      await expect(
        doctorCommand.parseAsync(["--json", "--bogus-flag-123"], { from: "user" }),
      ).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(2);
      expect(log).toHaveBeenCalledTimes(1);
      const report = parseEnvelope(String(log.mock.calls[0]?.[0]));
      expect(report.schemaVersion).toBe(1);
      expect(report.data.ready).toBe(false);
      expect(report.errors[0].code).toBe("USAGE");
      expect(report.errors[0].message).toContain("unknown option '--bogus-flag-123'");
    } finally {
      stderrSpy.mockRestore();
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it("reports WebContainer host as a blocking finding in JSON mode", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("Missing process.platform descriptor");
    const versions = process.versions as Record<string, string | undefined>;
    const prevWebContainer = versions.webcontainer;
    const { log, exit } = captureOutput();
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
      versions.webcontainer = "1";

      await expect(doctorCommand.parseAsync(["--json"], { from: "user" })).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);
      expect(log).toHaveBeenCalledTimes(1);

      const rawStdout = String(log.mock.calls[0]?.[0]);
      expect(rawStdout).not.toContain("Flisk Doctor");
      expect(rawStdout).not.toMatch(/[🔍✓✗○⚠]/u);

      const report = parseEnvelope(rawStdout);
      expect(report.data.ready).toBe(false);
      expect(report.data.host).toMatchObject({ kind: "webcontainer", canUp: false });
      expect(report.data.checks[0].name).toBe("Host");
      expect(report.data.checks[0].message).toBe(WEBCONTAINER_UP_MESSAGE);
      expect(report.data.checks[0].fix).toContain(WEBCONTAINER_DOCS);
    } finally {
      if (prevWebContainer !== undefined) {
        versions.webcontainer = prevWebContainer;
      } else {
        delete versions.webcontainer;
      }
      Object.defineProperty(process, "platform", platform);
      log.mockRestore();
      exit.mockRestore();
    }
  });

  it("redacts secret values across check results, fixes, and error messages in JSON output", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("Missing process.platform descriptor");
    const secretKey = "super-secret-production-token-9988";
    vi.mocked(envSecretValues).mockReturnValue([secretKey]);
    vi.mocked(getHostPortPlan).mockResolvedValue({
      ingressHttp: 80,
      ingressHttps: 443,
      postgres: 5432,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "preferred", ingressHttps: "preferred", postgres: "preferred" },
    });
    vi.mocked(collectDoctorChecks).mockResolvedValue({
      checks: [
        {
          name: "API Connection",
          didPass: false,
          message: `Connection failed with token ${secretKey}`,
          fix: `Verify key ${secretKey} in dashboard`,
        },
      ],
      errors: [
        {
          code: "INTERNAL",
          message: `Probe leaked secret: ${secretKey}`,
        },
      ],
    });

    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

      const { log, exit } = captureOutput();
      await expect(
        doctorCommand.parseAsync(["--json", "--no-ping"], { from: "user" }),
      ).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(2);

      const rawStdout = String(log.mock.calls[0]?.[0]);
      expect(rawStdout).not.toContain(secretKey);
      expect(rawStdout).toContain("[REDACTED]");

      const report = parseEnvelope(rawStdout);
      expect(report.data.checks[0].message).toBe("Connection failed with token [REDACTED]");
      expect(report.data.checks[0].fix).toBe("Verify key [REDACTED] in dashboard");
      expect(report.errors[0].message).toBe("Probe leaked secret: [REDACTED]");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("reports EnvUnreadableError in JSON envelope with code ENV_UNREADABLE and exits 1", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("Missing process.platform descriptor");
    vi.mocked(envSecretValues).mockImplementation(() => {
      throw new EnvUnreadableError(".env", "unreadable permissions (EACCES)");
    });
    vi.mocked(getHostPortPlan).mockResolvedValue({
      ingressHttp: 80,
      ingressHttps: 443,
      postgres: 5432,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "preferred", ingressHttps: "preferred", postgres: "preferred" },
    });
    vi.mocked(collectDoctorChecks).mockResolvedValue({
      checks: [PASSING_CHECK],
      errors: [],
    });

    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

      const { log, exit } = captureOutput();
      await expect(
        doctorCommand.parseAsync(["--json", "--no-ping"], { from: "user" }),
      ).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);

      const rawStdout = String(log.mock.calls[0]?.[0]);
      const report = parseEnvelope(rawStdout);
      expect(report.data.ready).toBe(false);
      expect(report.data.checks).toEqual([]);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].code).toBe("ENV_UNREADABLE");
      expect(report.errors[0].message).toContain("unreadable permissions");
    } finally {
      vi.mocked(envSecretValues).mockReturnValue([]);
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("includes planned doctor fix actions in JSON report and fails ready state when an action fails", () => {
    const passingAction: DoctorAction = {
      id: "prune-networks",
      check: "Docker networks",
      scope: "project",
      command: "docker network prune -f",
      status: "applied",
      reason: "pruned 2 networks",
    };
    const failedAction: DoctorAction = {
      id: "stop-tilt",
      check: "Tilt instances",
      scope: "project",
      command: "kill -9 9999",
      status: "failed",
      reason: "process not found",
    };

    const reportWithPassingAction = createDoctorReport([PASSING_CHECK], true);
    reportWithPassingAction.data.actions = [passingAction];
    expect(hasFailedActions(reportWithPassingAction.data.actions)).toBe(false);
    expect(reportWithPassingAction.data.ready).toBe(true);
    expect(getDoctorExitCode(reportWithPassingAction)).toBe(0);

    const reportWithFailedAction = createDoctorReport([PASSING_CHECK], true);
    reportWithFailedAction.data.actions = [failedAction];
    expect(hasFailedActions(reportWithFailedAction.data.actions)).toBe(true);
    if (hasFailedActions(reportWithFailedAction.data.actions)) {
      reportWithFailedAction.data.ready = false;
    }
    expect(reportWithFailedAction.data.ready).toBe(false);
    expect(getDoctorExitCode(reportWithFailedAction)).toBe(1);
  });

  it("emits complete JSON output schema with port breakdown and mocked probe results", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("Missing process.platform descriptor");
    vi.mocked(getHostPortPlan).mockResolvedValue({
      ingressHttp: 8080,
      ingressHttps: 8443,
      postgres: 5433,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: true, ingressHttps: true, postgres: true },
      reason: {
        ingressHttp: "env override",
        ingressHttps: "env override",
        postgres: "env override",
      },
    });

    const runtimeCheck: CheckResult = {
      name: "Container Runtime",
      didPass: true,
      message: "Docker daemon is running",
    };
    const probeFailingCheck: CheckResult = {
      name: "Service Health",
      didPass: false,
      message: "http://api.tdk.localhost:8080/health returned 503 Service Unavailable",
      fix: "flisk logs to inspect container health",
    };
    const probePassingCheck: CheckResult = {
      name: "Advertised Endpoints",
      didPass: true,
      message: "All 2 advertised routes responded with expected HTTP status",
    };

    vi.mocked(collectDoctorChecks).mockResolvedValue({
      checks: [runtimeCheck, probeFailingCheck, probePassingCheck],
      errors: [],
    });

    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

      const { log, exit } = captureOutput();
      await expect(doctorCommand.parseAsync(["--json"], { from: "user" })).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);

      const rawStdout = String(log.mock.calls[0]?.[0]);
      const report = parseEnvelope(rawStdout);

      expect(report.schemaVersion).toBe(1);
      expect(report.data.ready).toBe(false);
      expect(report.data.ports).toEqual({
        http: { requested: 80, chosen: 8080, explicit: true, reason: "env override" },
        https: { requested: 443, chosen: 8443, explicit: true, reason: "env override" },
        postgres: { requested: 5432, chosen: 5433, explicit: true, reason: "env override" },
      });
      expect(report.data.host).toMatchObject({
        canUp: true,
        containerRuntimeReachable: true,
      });

      // Failing checks ordered first by orderDoctorResults
      expect(report.data.checks).toEqual([probeFailingCheck, runtimeCheck, probePassingCheck]);
      expect(report.errors).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});

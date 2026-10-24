# Maintainers' Decision: Native Windows Runtime Execution

**Status:** Decided (Inspection-Only)  
**RFC Issue:** [#1757](https://github.com/flisk-sh/flisk/issues/1757)  
**Related Issues & Changes:** [#107](https://github.com/flisk-sh/flisk/issues/107) (Windows/WSL2 quickstart validation), [#165](https://github.com/flisk-sh/flisk/pull/165) (native Windows CLI foundation), [#661](https://github.com/flisk-sh/flisk/issues/661) (inspection-only policy), [#1765](https://github.com/flisk-sh/flisk/issues/1765) (Windows hardware validation inventory), [#1856](https://github.com/flisk-sh/flisk/issues/1856) (native Windows doctor diagnostics), [#1873](https://github.com/flisk-sh/flisk/pull/1873) (native Windows demo refusal).  
**Date:** 2026-10-23  

---

## 1. Context and Problem Statement

Flisk currently supports macOS, Linux, and Ubuntu in WSL2 for local runtime workflows (`flisk up`, live-reloading Tilt orchestration, Traefik routing, and background service lifecycle). On native Windows (Windows 10 22H2+, Windows 11, and Windows Server 2022+ on AMD64), the CLI executable `tdk.exe` is fully compiled, packaged, and distributed, but its runtime behavior is intentionally restricted to **inspection-only**: commands such as `flisk --version`, `flisk doctor`, `flisk project`, `flisk upgrade`, `flisk completion`, and `flisk up --dry-run` work, while commands that start containers (`flisk up` and `flisk demo`) refuse execution before touching the system with the message:

> `"Landscape startup needs Ubuntu on WSL2. Native Windows is inspect-only."`

Issue [#1757](https://github.com/flisk-sh/flisk/issues/1757) opened an RFC to formally evaluate user demand, assess technical prerequisites and blockers for native Windows runtime support, record an explicit maintainers' decision, and define an acceptance matrix for any future reconsideration.

---

## 2. Platform Capability Matrix (Current State)

The table below documents verified capabilities across supported Unix platforms, WSL2 Ubuntu, and native Windows AMD64 today:

| Capability | macOS (Darwin) | Linux (x64 / arm64) | WSL2 (Ubuntu) | Native Windows (AMD64) |
| :--- | :--- | :--- | :--- | :--- |
| **CLI binaries & packaging** | Standalone binary & npm | Standalone binary & npm | Standalone binary & npm | `tdk-windows-amd64.exe` & npm |
| **Inspection (`--version`, `help`)** | Supported | Supported | Supported | Supported |
| **System diagnostics (`doctor`)** | Supported | Supported | Supported | Supported (Windows-specific checks run via [#1875](https://github.com/flisk-sh/flisk/pull/1875)) |
| **Project scaffolding (`project`)** | Supported | Supported | Supported | Supported (with Bun installed) |
| **Shell completion** | Bash, Zsh, Fish | Bash, Zsh, Fish | Bash, Zsh, Fish | PowerShell profile integration |
| **Configuration verification** | Supported | Supported | Supported | Supported |
| **Dry-run planning (`up --dry-run`)** | Supported | Supported | Supported | Supported (no containers started) |
| **Stack startup (`flisk up`)** | Supported (Docker/Tilt) | Supported (Docker/Tilt) | Supported (Docker/Tilt) | **Refused** (requires WSL2 Ubuntu) |
| **One-command demo (`flisk demo`)** | Supported | Supported | Supported (WS6 verified) | **Refused** early (no clone/install) |
| **Escape hatch (`TDK_ALLOW_NATIVE_WINDOWS=1`)**| N/A | N/A | N/A | Available (unsupported / experimental) |

---

## 3. Technical Spike: Blocker Analysis

A thorough spike evaluated the mechanical and orchestration differences between Linux/WSL2 and native Windows runtime execution:

### 3.1 Docker Desktop Communication & Container Mode
- **Named Pipes vs. Unix Sockets:** Docker on native Windows primarily exposes the named pipe `npipe:////./pipe/docker_engine`. While Docker CLI and Docker Desktop bridge this, child tools spawned by Starlark or Tilt expecting `/var/run/docker.sock` fail unless a named pipe proxy or TCP socket is configured.
- **Linux vs. Windows Containers:** Flisk container images (`l1`-`l4` golden images, Traefik, PostgreSQL 16) are built exclusively as Linux containers. If Docker Desktop is configured in Windows container mode, `flisk doctor` detects this and fails fast (`checkWindowsDockerMode`). Even in Linux container mode, bind mounts cross the Windows host boundary into the Docker Desktop Linux VM, introducing filesystem sync latencies and permission mapping divergence.

### 3.2 Tilt Lifecycle & POSIX Starlark Assumptions
- **Tilt for Windows (`tilt.exe`):** While Tilt provides a Windows binary, Flisk's `engine/` Starlark topologies make extensive use of POSIX shell commands (`sh`, `/bin/sh -c`, `test -f`, `curl`). Spawning these commands on a native Windows host fails without MSYS2/Git Bash, neither of which is guaranteed or supported as a standard developer toolchain.
- **Signal Handling & Process Tree Teardown:** On Windows, process cancellation does not propagate via POSIX signals (`SIGINT`, `SIGTERM`, `SIGKILL`). Terminating `flisk up` via `Ctrl+C` in PowerShell or cmd.exe frequently leaves detached `tilt.exe` background processes, orphaned Docker port forwarders, and uncollected resources.

### 3.3 File Watching and Hot Reloading
- **Filesystem Event Discrepancies:** Windows uses `ReadDirectoryChangesW`, which behaves differently from Linux `inotify` or macOS `kqueue` regarding recursive subdirectory watching and atomic file renames.
- **CRLF vs. LF Line Endings:** Git checkouts on Windows with `core.autocrlf=true` alter file line endings, which corrupts content hashes used by Flisk snapshot drift detection (`.tdk-contract`) and golden layer cache invalidation.
- **Path Case Sensitivity:** Windows NTFS is case-preserving but case-insensitive by default, whereas the container runtime inside the Linux VM is strictly case-sensitive. This discrepancy causes import path failures that only appear inside the running container.

### 3.4 Paths and Filesystem Restrictions
- **Path Delimiters and Drive Letters:** Windows absolute paths (`C:\path\to\service`) break naive POSIX path joining and Starlark string manipulations that expect leading slashes (`/`).
- **Paths with Spaces:** Windows default user directories frequently include spaces (e.g., `C:\Users\First Last\...`). While CLI utilities have been hardened for spaces, container bind mount specifications and shell-escaped commands in third-party Tilt extensions remain fragile.
- **MAX_PATH (260 Characters):** Deep nested Node/Bun dependencies or monorepo layouts risk hitting the legacy 260-character path limit unless the host system has registry long paths explicitly enabled.

### 3.5 Host Networking and Port Collisions
- **Port 80/443 Ingress Conflicts:** Windows hosts frequently run `W3SVC` (IIS) or the HTTP.sys kernel listener, occupying port 80.
- **Hyper-V / WSL Dynamic Port Exclusions:** Windows dynamically reserves broad TCP port ranges for Hyper-V and WSL (`netsh interface ipv4 show excludedportrange protocol=tcp`), colliding unpredictably with standard ports (80, 443, 5432).
- **Wildcard `*.localhost` DNS Resolution:** Unlike macOS and Linux, native Windows DNS client resolvers do not natively resolve wildcard `*.localhost` subdomains (such as `api.shop.localhost`) to `127.0.0.1` without manual `hosts` file modification or external DNS proxy tools.

### 3.6 Teardown and Network Cleanup
- Aborting a stack run on native Windows leaves Docker bridge networks and container port mappings locked if the child process termination is not cleanly orchestrated via Windows Job Objects.

---

## 4. The Maintainers' Decision

**Decision:** **Maintain the inspection-only boundary on native Windows AMD64. Do not support native Windows runtime execution (`flisk up`) at this time.**

### Rationale:
1. **WSL2 Ubuntu Provides a Superior Experience:** Docker Desktop on Windows already runs its container engine inside a WSL2 lightweight utility VM. Developing directly within Ubuntu in WSL2 gives developers 100% native POSIX signals, inotify file watching, standard Unix domain sockets, and native container filesystem performance without impedance mismatches.
2. **Predictability and Reliability (Principle of #661):** Per Flisk's guiding principle *"Do not make TDK bigger. Make TDK trustworthy."*, supporting native Windows runtime execution would require continuous maintenance of an extensive compatibility layer (Starlark POSIX emulation, Windows Job Object cancellation, volume mount translation, DNS workarounds) that adds significant fragility.
3. **Inspection and Scaffolding Remain First-Class:** Native Windows developers can install the official binary, run diagnostics (`flisk doctor`), scaffold projects (`flisk project`), inspect dry-run plans (`flisk up --dry-run`), and install completions. When ready to boot the stack, they transition seamlessly to Ubuntu in WSL2.
4. **Unsupported Escape Hatch Preserved:** For developers and contributors conducting experiments, `TDK_ALLOW_NATIVE_WINDOWS=1` remains in place to bypass the refusal check without changing official support guarantees.

---

## 5. Acceptance Matrix for Future Native Runtime Evaluation

If user demand or upstream ecosystem shifts (e.g., Tilt native Starlark execution on Windows without shell requirements) warrant revisiting native Windows runtime execution in the future, all of the following acceptance gates must pass before support can be planned or claimed:

| Gate | Category | Requirement | Validation Method |
| :--- | :--- | :--- | :--- |
| **G1** | **Orchestration** | Tilt topologies and Starlark modules must execute cleanly via `tilt.exe` without `/bin/sh` or POSIX toolchain assumptions. | Automated Windows unit and engine tests. |
| **G2** | **Lifecycle** | `flisk up` and `Ctrl+C` must use Windows Job Objects or equivalent process groups to guarantee zero orphaned Tilt or Docker processes. | Process audit test verifying clean exit. |
| **G3** | **Filesystem** | Volume mounts must reliably map Windows paths (including paths with spaces) to Linux container targets without file lock contention. | Live reload test verifying bidirectional sync. |
| **G4** | **Networking** | Wildcard `*.localhost` routing must resolve cleanly to ingress ports without requiring administrator privileges or manual `hosts` editing. | End-to-end HTTP routing verification test. |
| **G5** | **Ports** | Automatic port fallback must cleanly navigate Hyper-V excluded port ranges and IIS collisions without hanging. | Dynamic port allocation verification test. |
| **G6** | **CI Gate** | A dedicated Windows live-stack CI workflow on a real or self-hosted Windows 11 AMD64 machine must run `flisk up` and pass all service health checks. | Automated pass in `.github/workflows/e2e-platforms-hardware.yml`. |

---

## 6. Platform-Support Claims Boundary

- **No platform-support claims change as a result of this decision.**
- The [README](../../README.md#requirements-and-support), [Operator Runbook](../operator-runbook.md), and [Public Claims Registry](../claims.md) strictly maintain that **native Windows is inspection-only** and that running the local stack requires macOS, Linux, or Ubuntu on WSL2.
- Any change to this claim remains strictly gated on passing gates **G1–G6** above.

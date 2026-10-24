## Context

Flisk targets fast, deterministic local development using Docker and Tilt. Native Windows AMD64 CLI support (`tdk.exe`) provides full inspection, diagnostics (`doctor`), scaffolding (`project`), upgrade, and completions. However, running multi-service topologies locally on native Windows introduces significant orchestration frictions due to differences in process signalling, filesystem watching, Starlark POSIX execution, Docker named pipes, and wildcard DNS.

## Decisions

1. **Retain Inspection-Only Support on Native Windows AMD64:**
   `flisk up` and `flisk demo` will continue to refuse execution on native Windows with the guidance pointing users to Ubuntu on WSL2.
2. **Standardize on WSL2 for Windows Developers:**
   Because Docker Desktop on Windows runs Linux containers inside a WSL2 backend, running Flisk directly within Ubuntu in WSL2 provides identical POSIX semantics, native file watching, standard Unix domain sockets, and identical performance to Linux without maintaining a complex Windows-specific orchestration emulation layer.
3. **Establish a Strict Acceptance Matrix for Future Re-evaluation:**
   Any future reconsideration of native Windows runtime execution must satisfy gates G1–G6 covering POSIX-free Tilt topologies, Windows Job Object cancellation, volume path mapping, non-elevated loopback DNS, dynamic port exclusion handling, and passing Windows hardware E2E CI.
4. **Preserve the Escape Hatch:**
   `TDK_ALLOW_NATIVE_WINDOWS=1` is preserved for experimental testing and contributor investigation.

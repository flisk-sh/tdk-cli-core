## Why

Flisk currently supports macOS, Linux, and WSL2 for local runtime workflows. Native Windows behavior is documented as inspection-only; changing that boundary needs an explicit decision because the runtime depends on Docker, Tilt, file watching, process signals, paths, and networking.

This RFC resolves [#1757](https://github.com/flisk-sh/flisk/issues/1757) by evaluating user demand and technical requirements for native Windows runtime support, recording an explicit maintainers' decision, and establishing an acceptance matrix.

## What Changes

- Evaluate and record the platform capabilities of native Windows, WSL2, and supported Unix platforms.
- Document the results of the technical spike across Docker Desktop, Tilt lifecycle, file watching, process cancellation, paths, ports, and network cleanup.
- Record the maintainers' decision: explicitly retain the inspection-only boundary on native Windows AMD64, keeping WSL2 Ubuntu as the supported runtime environment on Windows hosts.
- Establish an acceptance matrix defining the prerequisite gates (G1–G6) required before any future native Windows runtime execution can be considered or claimed.
- Update repository documentation (`docs/design/native-windows-runtime-decision.md`, `docs/windows-hardware.md`, `docs/operator-runbook.md`, `docs/README.md`) to link to the formal decision.

## Capabilities

### Modified Capabilities

- `native-windows-cli`: Formally codifies the inspection-only scope for native Windows AMD64 and preserves the `TDK_ALLOW_NATIVE_WINDOWS=1` escape hatch for experimental exploration.

## Non-goals

- Implementing native Windows container startup in `flisk up` or changing the refusal message.
- Changing platform support claims in `README.md` or marketing.
- Modifying Unix or WSL2 runtime behavior.

## Impact

- Documentation and design artifacts: `docs/design/native-windows-runtime-decision.md`, `docs/windows-hardware.md`, `docs/operator-runbook.md`, `docs/README.md`.
- No runtime code or CLI behavior changes required.

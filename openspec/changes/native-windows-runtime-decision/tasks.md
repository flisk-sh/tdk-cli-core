## 1. Documentation and Decision Record

- [x] 1.1 Document platform capabilities across macOS, Linux, WSL2 Ubuntu, and native Windows AMD64.
- [x] 1.2 Document technical spike findings across Docker Desktop, Tilt lifecycle, file watching, process cancellation, paths, ports, and network cleanup.
- [x] 1.3 Record the explicit maintainers' decision in `docs/design/native-windows-runtime-decision.md` choosing to keep inspection-only support on native Windows and recommending WSL2 Ubuntu.
- [x] 1.4 Define the future acceptance matrix gates G1–G6.
- [x] 1.5 Update `docs/windows-hardware.md`, `docs/operator-runbook.md`, and `docs/README.md` to reference the decision.
- [x] 1.6 Verify that existing unit tests and platform refusal contracts continue to pass without regression.

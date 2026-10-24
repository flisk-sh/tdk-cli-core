## MODIFIED Requirements

### Requirement: Native platform and architecture mapping
The CLI SHALL continue to recognize `process.platform === "win32"` as Windows and `process.arch === "x64"` as AMD64. Native Windows SHALL remain an inspection-only platform for CLI workflows. Stack startup commands (`flisk up` and `flisk demo`) SHALL refuse execution on native Windows with guidance to run under Ubuntu in WSL2 unless the unsupported `TDK_ALLOW_NATIVE_WINDOWS=1` override is set.

#### Scenario: Stack startup refusal on native Windows
- **WHEN** a user executes `flisk up` or `flisk demo` on a native Windows host without `TDK_ALLOW_NATIVE_WINDOWS=1`
- **THEN** the CLI exits non-zero and prints `"Landscape startup needs Ubuntu on WSL2. Native Windows is inspect-only."`
- **AND** starts no Tilt process, Docker daemon communication, or container workloads

#### Scenario: Inspection commands succeed on native Windows
- **WHEN** a user executes `flisk --version`, `flisk doctor`, `flisk project`, `flisk upgrade`, or `flisk up --dry-run` on native Windows
- **THEN** the commands execute and report platform findings without refusing

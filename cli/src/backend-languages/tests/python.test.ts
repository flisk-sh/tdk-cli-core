import { describe, expect, it } from "vitest";
import { pythonBackendProvider, PYTHON_DEV_COMMAND } from "../python.js";

describe("Python Backend Language Module", () => {
  it("should verify provider configuration", () => {
    expect(pythonBackendProvider.id).toBe("python");
    expect(pythonBackendProvider.label).toBe("Python 3.12 + FastAPI");
    expect(pythonBackendProvider.devCommand).toBe(PYTHON_DEV_COMMAND);
    
  });

  it("should generate the expected configuration files", () => {
    expect(pythonBackendProvider.createFiles).toBeDefined();
const files = pythonBackendProvider.createFiles!("test-app");

    expect(files.map((file) => file.filename)).toEqual([
      "pyproject.toml",
      "src/main.py",
      "tests/test_health.py",
    ]);
  });

  it("should use the supplied project name in generated files", () => {
    expect(pythonBackendProvider.createFiles).toBeDefined();
const files = pythonBackendProvider.createFiles!("test-app");
    const projectConfig = files.find(
      (file) => file.filename === "pyproject.toml",
    );

    expect(projectConfig?.content).toContain( "test-app");
  });

  it("should include Python version and dependencies", () => {
    expect(pythonBackendProvider.createFiles).toBeDefined();
const files = pythonBackendProvider.createFiles!("test-app");
    const projectConfig = files.find(
      (file) => file.filename === "pyproject.toml",
    );

    expect(projectConfig?.content).toContain('requires-python = ">=3.12"');
    expect(projectConfig?.content).toContain("fastapi");
    expect(projectConfig?.content).toContain("uvicorn");
  });

  it("should generate health-check endpoints", () => {
    expect(pythonBackendProvider.createFiles).toBeDefined();
const files = pythonBackendProvider.createFiles!("test-app");
    const mainFile = files.find(
      (file) => file.filename === "src/main.py",
    );

    expect(mainFile?.content).toContain('@app.get("/health")');
    expect(mainFile?.content).toContain('@app.get("/")');
    expect(mainFile?.content).toContain('"status": "ok"');
  });

  it("should generate a health-check test file", () => {
    expect(pythonBackendProvider.createFiles).toBeDefined();
const files = pythonBackendProvider.createFiles!("test-app");
    const testFile = files.find(
      (file) => file.filename === "tests/test_health.py",
    );

    expect(testFile?.content).toContain("def test_health()");
    expect(testFile?.content).toContain('client.get("/health")');
    expect(testFile?.content).toContain("def test_root()");
  });
});
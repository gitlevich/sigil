import { describe, it, expect, beforeEach } from "vitest";
import {
  getBase, setBase, clearBase,
  pauseAutoSaveFor, resumeAutoSaveFor, isAutoSavePaused,
  getAutoSavePendingPath, getAutoSavePendingContent,
} from "../src/hooks/useAutoSave";

describe("base version tracking", () => {
  beforeEach(() => {
    clearBase("/test/language.md");
    clearBase("/test/other.md");
  });

  it("returns null for untracked path", () => {
    expect(getBase("/nonexistent")).toBeNull();
  });

  it("stores and retrieves base content", () => {
    setBase("/test/language.md", "original content");
    expect(getBase("/test/language.md")).toBe("original content");
  });

  it("overwrites previous base", () => {
    setBase("/test/language.md", "v1");
    setBase("/test/language.md", "v2");
    expect(getBase("/test/language.md")).toBe("v2");
  });

  it("clearBase removes the entry", () => {
    setBase("/test/language.md", "content");
    clearBase("/test/language.md");
    expect(getBase("/test/language.md")).toBeNull();
  });

  it("tracks independent paths", () => {
    setBase("/test/language.md", "a");
    setBase("/test/other.md", "b");
    expect(getBase("/test/language.md")).toBe("a");
    expect(getBase("/test/other.md")).toBe("b");
  });
});

describe("pause control", () => {
  beforeEach(() => {
    resumeAutoSaveFor("/test/language.md");
  });

  it("is not paused by default", () => {
    expect(isAutoSavePaused("/test/language.md")).toBe(false);
  });

  it("can be paused", () => {
    pauseAutoSaveFor("/test/language.md");
    expect(isAutoSavePaused("/test/language.md")).toBe(true);
  });

  it("can be resumed", () => {
    pauseAutoSaveFor("/test/language.md");
    resumeAutoSaveFor("/test/language.md");
    expect(isAutoSavePaused("/test/language.md")).toBe(false);
  });

  it("pause is per-path", () => {
    pauseAutoSaveFor("/test/language.md");
    expect(isAutoSavePaused("/test/other.md")).toBe(false);
  });
});

describe("pending write tracking", () => {
  it("initially has no pending path", () => {
    expect(getAutoSavePendingPath()).toBeNull();
  });

  it("initially has no pending content", () => {
    expect(getAutoSavePendingContent()).toBeNull();
  });
});

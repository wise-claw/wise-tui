import { describe, expect, test } from "bun:test";
import {
  isMonacoSupportedFilePath,
  isRepositoryExternalDefaultAppPath,
  monacoLanguageFromRepositoryPath,
  shouldOpenRepositoryFileInMonaco,
} from "./repositoryFilePreview";

describe("shouldOpenRepositoryFileInMonaco", () => {
  test("allows unknown text-like extensions", () => {
    expect(shouldOpenRepositoryFileInMonaco("src/foo.bar")).toBe(true);
    expect(shouldOpenRepositoryFileInMonaco("Makefile")).toBe(true);
    expect(shouldOpenRepositoryFileInMonaco(".env.local")).toBe(true);
  });

  test("blocks dedicated preview and external app paths", () => {
    expect(shouldOpenRepositoryFileInMonaco("a.png")).toBe(false);
    expect(shouldOpenRepositoryFileInMonaco("a.pdf")).toBe(false);
    expect(shouldOpenRepositoryFileInMonaco("a.docx")).toBe(false);
    expect(shouldOpenRepositoryFileInMonaco("a.mp4")).toBe(false);
    expect(shouldOpenRepositoryFileInMonaco("sheet.xlsx")).toBe(false);
    expect(shouldOpenRepositoryFileInMonaco("deck.pptx")).toBe(false);
  });
});

describe("isRepositoryExternalDefaultAppPath", () => {
  test("detects video excel ppt", () => {
    expect(isRepositoryExternalDefaultAppPath("clip.mov")).toBe(true);
    expect(isRepositoryExternalDefaultAppPath("data.csv")).toBe(true);
    expect(isRepositoryExternalDefaultAppPath("slides.ppt")).toBe(true);
    expect(isRepositoryExternalDefaultAppPath("readme.md")).toBe(false);
  });
});

describe("isMonacoSupportedFilePath", () => {
  test("matches shouldOpenRepositoryFileInMonaco", () => {
    expect(isMonacoSupportedFilePath("unknown.ext")).toBe(true);
    expect(isMonacoSupportedFilePath("video.webm")).toBe(false);
  });
});

describe("monacoLanguageFromRepositoryPath", () => {
  test("falls back to plaintext for unknown extensions", () => {
    expect(monacoLanguageFromRepositoryPath("foo.xyz")).toBe("plaintext");
    expect(monacoLanguageFromRepositoryPath("src/main.ts")).toBe("typescript");
  });
});

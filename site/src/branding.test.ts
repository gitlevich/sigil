/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("branding assets", () => {
  it("keeps the dual logo frameless and circular", () => {
    const logo = readText("../../sigil-logo-dual.svg");

    expect(logo).toContain('viewBox="0 0 240 240"');
    expect(logo).toContain('--ring: #d9dee4;');
    expect(logo).toContain('circle cx="120" cy="120" r="118" fill="var(--bg)" stroke="var(--ring)" stroke-width="4"');
    expect(logo).not.toMatch(/<rect\b/);
  });

  it("keeps the favicon geometry in sync with the logo", () => {
    const favicon = readText("../public/favicon.svg");

    expect(favicon).toContain('viewBox="0 0 240 240"');
    expect(favicon).toContain('--ring: #d9dee4;');
    expect(favicon).toContain('circle cx="120" cy="120" r="118" fill="var(--bg)" stroke="var(--ring)" stroke-width="4"');
    expect(favicon).not.toMatch(/<rect\b/);
  });

  it("sets the landing in paper, ink, and one vermilion accent", () => {
    const css = readText("./App.css");

    expect(css).toContain("--paper: #fdfdfc;");
    expect(css).toContain("--vermilion: #bb3a1d;");
    expect(css).toContain('--serif: "Newsreader"');
    expect(css).toContain('--mono: "Fragment Mono"');
    expect(css).toContain("prefers-color-scheme: dark");
  });

  it("shows the logo in the hero and keeps the title at document scale", () => {
    const app = readText("./App.tsx");
    const css = readText("./App.css");

    expect(app).toContain('src="/favicon.svg"');
    expect(app).toContain('className="hero-logo"');
    expect(css).toContain("font-size: clamp(2.1rem, 4.5vw, 2.75rem);");
    expect(css).toContain("max-width: 24ch;");
    expect(css).toContain("@media (max-width: 540px)");
  });

  it("keeps body copy at reading size on a single measure", () => {
    const css = readText("./App.css");

    expect(css).toContain("width: min(40rem, calc(100vw - 3rem));");
    expect(css).toContain("font-size: 1.375rem;");
    expect(css).toContain("line-height: 1.6;");
  });

  it("renders links as a hairline index, not cards", () => {
    const css = readText("./App.css");
    const indexCss = readText("./index.css");

    expect(css).toContain("border-bottom: 1px solid var(--line);");
    expect(css).not.toContain("box-shadow: 0 24px");
    expect(indexCss).toContain("overflow-y: auto;");
    expect(indexCss).toContain("overflow-x: hidden;");
    expect(indexCss).toContain("#root");
  });
});

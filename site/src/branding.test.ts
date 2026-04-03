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

  it("shows the logo in the hero and relaxes the mobile title spacing", () => {
    const app = readText("./App.tsx");
    const css = readText("./App.css");

    expect(app).toContain('src="/favicon.svg"');
    expect(app).toContain('className="hero-logo"');
    expect(css).toContain("max-width: 9.8ch;");
    expect(css).toContain("font-size: clamp(2.45rem, 12.5vw, 4rem);");
    expect(css).toContain("line-height: 1;");
    expect(css).toContain("letter-spacing: -0.03em;");
    expect(css).toContain("@media (max-width: 540px)");
    expect(css).toContain("max-width: 10.6ch;");
    expect(css).toContain("font-size: clamp(2.15rem, 11.2vw, 3.35rem);");
    expect(css).toContain("letter-spacing: -0.022em;");
  });

  it("keeps the landing page scrollable and the card grid narrower than the text block", () => {
    const appCss = readText("./App.css");
    const indexCss = readText("./index.css");

    expect(appCss).toContain("padding: 3rem 0 max(6rem, 12vh);");
    expect(appCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(appCss).toContain("width: min(100%, 43rem);");
    expect(appCss).toContain("width: min(100%, 46rem);");
    expect(indexCss).toContain("overflow-y: auto;");
    expect(indexCss).toContain("overflow-x: hidden;");
    expect(indexCss).toContain("#root");
  });

  it("keeps body copy readable and pulls the hero lede closer to the title", () => {
    const css = readText("./App.css");

    expect(css).toContain("padding-bottom: 2.35rem;");
    expect(css).toContain("margin: 1.15rem 0 0;");
    expect(css).toContain("font-size: clamp(1.22rem, 2vw, 1.56rem);");
    expect(css).toContain("font-size: 1.22rem;");
    expect(css).toContain("line-height: 1.68;");
    expect(css).toContain("font-size: 1.04rem;");
  });
});

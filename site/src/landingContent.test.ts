import { describe, expect, it } from "vitest";
import pageSource from "../index.html?raw";
import { landingContent } from "./landingContent";
import essaySource from "./what-is-a-sigil.md?raw";

describe("landingContent", () => {
  it("frames sigil engineering as recovering structure from narratives", () => {
    const narrative = landingContent.story.join(" ");

    expect(landingContent.hero.title).toBe("How to recover the shape behind words.");
    expect(landingContent.hero.lede).toContain("Humans communicate in narratives");
    expect(landingContent.hero.lede).toContain("Minds understand in structures");
    expect(landingContent.story).toHaveLength(9);
    expect(narrative).toContain("shape");
    expect(narrative).toContain("paths");
    expect(narrative).toContain("observations");
    expect(narrative).toContain("latent shape");
    expect(narrative).toContain("vision");
    expect(narrative).toContain("affordances");
    expect(narrative).toContain("sigil");
    expect(narrative).toContain("invariants");
    expect(narrative).toContain("projections");
    expect(narrative).toContain("inhabit");
    expect(landingContent.pullQuote).toBe(
      "Narratives are measurements. Sigils are the latent structures that explain them.",
    );
  });

  it("introduces the design partner once and never renames it", () => {
    const fullText = [
      landingContent.hero.lede,
      ...landingContent.story,
      ...landingContent.implementation.paragraphs,
      landingContent.links.intro,
    ].join(" ");

    expect(fullText).toContain("design partner");
    expect(fullText).not.toMatch(/\bthe AI\b(?! resident)/);
  });

  it("states the public argument directly", () => {
    const publicProse = [
      landingContent.hero.lede,
      ...landingContent.story,
      ...landingContent.implementation.paragraphs,
      landingContent.links.intro,
      ...landingContent.links.items.map((item) => item.description),
      landingContent.contact.error,
      essaySource,
    ].join(" ");

    expect(publicProse).not.toMatch(/\b(?:not|without)\b/i);
    expect(pageSource).toContain(
      'content="Sigil Engineering recovers stable conceptual structures from narratives so people and AI agents can inhabit them."',
    );
  });

  it("anchors the tool section in what the editor implements", () => {
    const implementation = landingContent.implementation.paragraphs.join(" ");

    expect(implementation).toContain("vision");
    expect(implementation).toContain("ontology tree");
    expect(implementation).toContain("compiler");
    expect(implementation).toContain("Atlas");
    expect(implementation).toContain("Space");
    expect(implementation).toContain("design partner");
    expect(implementation).toContain("the same tools I hold");
  });

  it("closes the loop and exposes the model, repository, and release links", () => {
    expect(landingContent.links.title).toBe("The loop closes.");
    expect(landingContent.links.intro).toContain("written with the method");
    expect(landingContent.links.intro).toContain("work in progress");
    expect(landingContent.links.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "#/viewer", title: "Read the model" }),
        expect.objectContaining({ href: "https://github.com/gitlevich/sigil", external: true }),
        expect.objectContaining({
          href: "https://github.com/gitlevich/sigil/releases",
          external: true,
        }),
        expect.objectContaining({ href: "https://sigilatlas.com", title: "SigilAtlas", external: true }),
        expect.objectContaining({ href: "#/sigil", title: "What is a sigil?" }),
      ]),
    );
  });

  it("offers a direct contact path", () => {
    expect(landingContent.contact.title).toBe("Send a note.");
    expect(landingContent.contact.lede).toContain("send a message");
    expect(landingContent.contact.success).toBe("Message sent.");
    expect(landingContent.contact.directLabel).toBe("Prefer email?");
    expect(landingContent.contact.buttonIdle).toBe("Send message");
  });
});

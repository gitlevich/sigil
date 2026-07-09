import { describe, expect, it } from "vitest";
import { landingContent } from "./landingContent";

describe("landingContent", () => {
  it("keeps the landing page as a narrative from shape to inhabitation", () => {
    const narrative = landingContent.story.join(" ");

    expect(landingContent.story).toHaveLength(9);
    expect(narrative).toContain("shape");
    expect(narrative).toContain("space-like");
    expect(narrative).toContain("time-like");
    expect(narrative).toContain("vision");
    expect(narrative).toContain("affordances");
    expect(narrative).toContain("sigil");
    expect(narrative).toContain("invariants");
    expect(narrative).toContain("projection");
    expect(narrative).toContain("inhabit");
    expect(narrative).toContain("body");
    expect(narrative).toContain("cockpit");
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

  it("closes the loop and exposes the spec, repository, and release links", () => {
    expect(landingContent.links.title).toBe("The loop closes.");
    expect(landingContent.links.intro).toContain("written with the method");
    expect(landingContent.links.intro).toContain("work in progress");
    expect(landingContent.links.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "#/viewer", title: "Read the spec" }),
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

import { describe, expect, it } from "vitest";
import { landingContent } from "./landingContent";

describe("landingContent", () => {
  it("keeps the landing page as a narrative from shape to projection", () => {
    const narrative = landingContent.story.join(" ");

    expect(landingContent.story).toHaveLength(7);
    expect(narrative).toContain("shape");
    expect(narrative).toContain("space-like");
    expect(narrative).toContain("time-like");
    expect(narrative).toContain("vision");
    expect(narrative).toContain("affordances");
    expect(narrative).toContain("sigil");
    expect(narrative).toContain("invariants");
    expect(narrative).toContain("projection");
  });

  it("keeps the worked example anchored in the implemented tool", () => {
    const implementation = landingContent.implementation.paragraphs.join(" ");

    expect(implementation).toContain("vision");
    expect(implementation).toContain("ontology tree");
    expect(implementation).toContain("Atlas");
    expect(implementation).toContain("design partner");
  });

  it("exposes the public spec, repository, and release links", () => {
    expect(landingContent.links.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "#/viewer", title: "Browse the worked example" }),
        expect.objectContaining({ href: "https://github.com/gitlevich/sigil", external: true }),
        expect.objectContaining({
          href: "https://github.com/gitlevich/sigil/releases",
          external: true,
        }),
      ]),
    );
  });
});

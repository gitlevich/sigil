import landingSource from "./landing.md?raw";

export interface LandingLink {
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  href: string;
  external?: boolean;
}

// The prose lives in landing.md. This module parses it into the structure
// App.tsx renders. Section order in the file is fixed: hero (before the
// first ##), Story, Pull quote, Tool, Proof, Contact. A section heading of
// the form "Label: Title." splits into eyebrow label and section title.

function toParagraphs(block: string): string[] {
  return block
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

function splitHeading(heading: string): { label: string; title: string } {
  const colon = heading.indexOf(":");
  if (colon === -1) {
    return { label: heading.trim(), title: heading.trim() };
  }
  return {
    label: heading.slice(0, colon).trim(),
    title: heading.slice(colon + 1).trim(),
  };
}

function splitSection(section: string): { heading: string; body: string } {
  const newline = section.indexOf("\n");
  return {
    heading: section.slice(0, newline).trim(),
    body: section.slice(newline + 1),
  };
}

const sections = landingSource.split(/^## /m);
if (sections.length !== 6) {
  throw new Error(
    `landing.md must have 5 "## " sections (story, pull quote, tool, proof, contact); found ${sections.length - 1}`,
  );
}

const [kicker, heroTitle, heroLede] = toParagraphs(
  sections[0].replace(/^# /, ""),
);
const story = toParagraphs(splitSection(sections[1]).body);
const pullQuote = toParagraphs(splitSection(sections[2]).body)[0];
const tool = splitSection(sections[3]);
const proof = splitSection(sections[4]);
const contact = splitSection(sections[5]);

export const landingContent = {
  hero: {
    kicker,
    title: heroTitle,
    lede: heroLede,
  },
  story,
  pullQuote,
  implementation: {
    ...splitHeading(tool.heading),
    paragraphs: toParagraphs(tool.body),
  },
  links: {
    ...splitHeading(proof.heading),
    intro: toParagraphs(proof.body).join(" "),
    items: [
      {
        eyebrow: "Model",
        title: "Read the model",
        description:
          "The domain model the editor was projected from: every sigil's language, affordances, and invariants.",
        action: "Open the model viewer",
        href: "#/viewer",
      },
      {
        eyebrow: "Repository",
        title: "Read the code",
        description:
          "The editor, this site, and the model live in one public repository.",
        action: "Visit GitHub",
        href: "https://github.com/gitlevich/sigil",
        external: true,
      },
      {
        eyebrow: "In practice",
        title: "SigilAtlas",
        description:
          "An application designed this way and inhabited by an agent, entangling with its maker over a photographic corpus. The method at work on something real.",
        action: "Visit SigilAtlas",
        href: "https://sigilatlas.com",
        external: true,
      },
      {
        eyebrow: "Application",
        title: "Run the editor",
        description:
          "The macOS app the method is tested in — an early experiment, not a finished tool.",
        action: "Open releases",
        href: "https://github.com/gitlevich/sigil/releases",
        external: true,
      },
      {
        eyebrow: "Appendix",
        title: "What is a sigil?",
        description:
          "The term, the model of attention behind it, and why the method is named for it.",
        action: "Read the note",
        href: "#/sigil",
      },
    ] satisfies LandingLink[],
  },
  contact: {
    ...splitHeading(contact.heading),
    lede: toParagraphs(contact.body).join(" "),
    directLabel: "Prefer email?",
    directAction: "Write directly",
    success: "Message sent.",
    error:
      "The form did not send. Use the direct email link below and I will still get it.",
    buttonIdle: "Send message",
    buttonSending: "Sending...",
  },
  footer: "sigilengineering.com",
};

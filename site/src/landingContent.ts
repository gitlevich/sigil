export interface LandingLink {
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  href: string;
  external?: boolean;
}

export const landingContent = {
  hero: {
    kicker: "Sigil Engineering",
    title: "How to speak an app into being.",
    lede:
      "A method and an implemented editor for turning an application-shaped intuition into bounded language that an AI can refine and a coding agent can project into code.",
  },
  story: [
    "I do not first get an application as a backlog. I get it as a shape: something I can almost inhabit, with things that belong inside it, things that do not, and actions it should afford for me.",
    "The application arrives space-like, all at once. A specification and the code projected from it have to be written time-like, one sequence after another. Sigil engineering is the work of converting one into the other without losing the shape.",
    "I begin with a vision and keep it nearby, because attention drifts. Then I name the few things the application must let me do. Those affordances are the first handles on the shape.",
    "As I narrate those affordances, certain words stop feeling casual. They start carrying load. I enter one of them, define it at the next level of abstraction down, and narrate again from inside it.",
    "If the language inside is still vague, I descend again. Each bounded region becomes a sigil: a lexical scope with its own affordances and invariants. The tree can go as deep as it needs to, but each level stays small enough to hold in attention. Depth is fine. Sprawl is not.",
    "Because the tree holds the periphery, I and the AI can fully inhabit the current scope without losing the whole. The partner reads the entire structure, traces the vision through it, measures where the language drifts, and surfaces the places where the spec still falls off the edge.",
    "When the leaves are sharp enough that naming them suffices, the spec stops being notes about the application and becomes the application's shape rendered into language. At that point implementation is no longer guesswork. It is projection.",
  ],
  pullQuote: "The spec, the method, and the tool are the same shape.",
  implementation: {
    label: "Implemented Example",
    title: "Sigil Editor is the worked example.",
    paragraphs: [
      "I keep the vision one click away so I can refocus when attention wanders. I narrate in a comfortable editor, define affordances and invariants as they become clear, and let the language tell me where the boundaries actually are.",
      "While I write, the ontology tree shows the structure that is emerging. Atlas flattens that tree so I can see density and holes in the whole. The design partner inhabits the full sigil, helps me refine names and boundaries, imports precise ontology when my own language is too blunt, and tells me when the spec is precise enough to hand off.",
    ],
  },
  links: {
    label: "Public Artifact",
    title: "Read the actual thing.",
    items: [
      {
        eyebrow: "Specification",
        title: "Browse the worked example",
        description:
          "Open the specification that drove the implementation and inspect the method in its native form.",
        action: "Open the spec viewer",
        href: "#/viewer",
      },
      {
        eyebrow: "Repository",
        title: "Read the code",
        description:
          "The editor, the site, and the spec live in the public GitHub repository.",
        action: "Visit GitHub",
        href: "https://github.com/gitlevich/sigil",
        external: true,
      },
      {
        eyebrow: "Application",
        title: "Download the editor",
        description:
          "Use the macOS app to write your own sigils and work this way directly.",
        action: "Open releases",
        href: "https://github.com/gitlevich/sigil/releases",
        external: true,
      },
    ] satisfies LandingLink[],
  },
  contact: {
    label: "Contact",
    title: "Send a note.",
    lede:
      "If you want to try the editor, talk through the method, or discuss a project, send a message. I read these directly.",
    directLabel: "Prefer email?",
    directAction: "Write directly",
    success:
      "Message sent. If this address has not been activated with the form endpoint yet, the submission will be held until it is confirmed.",
    error:
      "The form did not send. Use the direct email link below and I will still get it.",
    buttonIdle: "Send message",
    buttonSending: "Sending...",
  },
  footer: "sigilengineering.com",
} as const;

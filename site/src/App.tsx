import { useState, useEffect, useRef } from "react";
import { motion, type Easing } from "framer-motion";
import { SigilViewer } from "./viewer/SigilViewer";

const ease: Easing = "easeOut";

const fade = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-100px" },
  transition: { duration: 0.8, ease },
} as const;

function Section({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      {...fade}
      className={`min-h-[60vh] flex flex-col justify-center px-6 md:px-16 lg:px-24 ${className}`}
    >
      {children}
    </motion.section>
  );
}

function Term({ name, definition }: { name: string; definition: string }) {
  return (
    <motion.div {...fade} className="py-3">
      <span className="text-[var(--color-bone)]">{name}</span>
      <span className="text-[var(--color-dim)]"> — {definition}</span>
    </motion.div>
  );
}

function Metric({ name, what }: { name: string; what: string }) {
  return (
    <motion.div
      {...fade}
      className="border border-[var(--color-faint)] p-6 flex flex-col gap-2"
    >
      <div className="text-sm text-[var(--color-dim)] uppercase tracking-widest">
        {name}
      </div>
      <div className="text-[var(--color-bone)]">{what}</div>
    </motion.div>
  );
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  const specLinkRef = useRef<HTMLAnchorElement>(null);
  const cameFromViewer = useRef(false);
  const prevHashRef = useRef(window.location.hash);

  useEffect(() => {
    const onHashChange = () => {
      const prev = prevHashRef.current;
      const next = window.location.hash;
      prevHashRef.current = next;
      if (prev.startsWith("#/viewer") && !next.startsWith("#/viewer")) {
        cameFromViewer.current = true;
      }
      setHash(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (cameFromViewer.current && specLinkRef.current) {
      cameFromViewer.current = false;
      specLinkRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      specLinkRef.current.classList.add("pulse-attention");
    }
  }, [hash]);

  if (hash.startsWith("#/viewer")) {
    return <SigilViewer />;
  }

  return (
    <main className="max-w-3xl mx-auto">
      {/* 1. Opening */}
      <Section className="min-h-[100vh] items-center text-center relative">
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5, ease }}
          className="text-4xl md:text-5xl lg:text-6xl font-light leading-tight tracking-tight"
        >
          A shape in contrast space
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5, delay: 0.8, ease }}
          className="mt-8 text-lg text-[var(--color-dim)]"
        >
          Sigil Engineering
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.25, y: [0, 8, 0] }}
          transition={{
            opacity: { duration: 2, delay: 2.5, ease },
            y: { duration: 2.5, repeat: Infinity, ease: "easeInOut" },
          }}
          className="absolute bottom-12 text-[var(--color-dim)] cursor-pointer"
          onClick={() =>
            window.scrollTo({ top: window.innerHeight, behavior: "smooth" })
          }
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 7 L10 13 L16 7" />
          </svg>
        </motion.div>
      </Section>

      {/* 2. The Method */}
      <Section>
        <h2 className="text-2xl md:text-3xl font-light mb-12 text-[var(--color-dim)]">
          The Method
        </h2>
        <div className="space-y-6 text-lg leading-relaxed">
          <motion.p {...fade}>Write a vision. What should this thing do?</motion.p>
          <motion.p {...fade}>
            Inhabit it. Imagine working with it. Name the affordances you need.
          </motion.p>
          <motion.p {...fade}>
            A language emerges. To define a word, zoom into it and repeat.
          </motion.p>
          <motion.p {...fade}>
            Stop when naming the leaves suffices. You care about their
            affordances, not their internals. A door handle affords opening the
            door — you don't care how it's made.
          </motion.p>
          <motion.p {...fade} className="text-[var(--color-dim)]">
            Outside in. Vision to leaf. Recursive containment. Each concept
            exists because you need it to express an affordance.
          </motion.p>
        </div>
      </Section>

      {/* Divider */}
      <div className="my-16 border-t border-[var(--color-faint)]" />

      {/* 3. The Core Chain */}
      <Section>
        <h2 className="text-2xl md:text-3xl font-light mb-12 text-[var(--color-dim)]">
          Attention Language
        </h2>
        <div className="text-base leading-relaxed font-light">
          <Term
            name="Attention"
            definition="finite capacity to observe. The resource everything else runs on"
          />
          <Term
            name="Observer"
            definition="attention paid from a point of view at a scale"
          />
          <Term
            name="Frame"
            definition="an ordered set of observations at a moment"
          />
          <Term
            name="Observation"
            definition="a measurement along a single contrast"
          />
          <Term
            name="Contrast"
            definition="a dimension along which attention discriminates"
          />
          <Term
            name="Preference"
            definition="a range over a contrast that an agent maintains"
          />
          <Term
            name="Invariant"
            definition="what a sigil enforces. Binds a preference to its boundary"
          />
          <Term
            name="Sigil"
            definition="a shape in contrast space where preferences hold"
          />
          <Term name="Agent" definition="an observer wearing a sigil" />
          <Term
            name="Narrative"
            definition="space-like frames compressed to a time-like trickle"
          />
          <Term
            name="Collapse"
            definition="choosing one reading from many, preserving invariants"
          />
        </div>
      </Section>

      {/* Divider */}
      <div className="my-16 border-t border-[var(--color-faint)]" />

      {/* 4. Coherence */}
      <Section>
        <h2 className="text-2xl md:text-3xl font-light mb-4 text-[var(--color-dim)]">
          Coherence
        </h2>
        <p className="text-[var(--color-dim)] mb-12">
          Computed silently, surfaced only when broken.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Metric
            name="Name Fit"
            what="Does the name sit at the center of what the sigil does?"
          />
          <Metric
            name="Sibling Separation"
            what="Do children carve the domain at real joints?"
          />
          <Metric
            name="Affordance Affinity"
            what="Is each affordance attached to the right sigil?"
          />
          <Metric
            name="Boundary Sharpness"
            what="Do the invariants describe the actual boundary?"
          />
          <Metric
            name="Language Flow"
            what="Few words = right structure. Many words = wrong model."
          />
        </div>
      </Section>

      {/* Divider */}
      <div className="my-16 border-t border-[var(--color-faint)]" />

      {/* 5. Coverage */}
      <Section>
        <h2 className="text-2xl md:text-3xl font-light mb-12 text-[var(--color-dim)]">
          Coverage
        </h2>
        <div className="space-y-6 text-lg leading-relaxed">
          <motion.p {...fade}>
            Vision sentences are trajectories through the sigil tree.
          </motion.p>
          <motion.p {...fade}>
            Trace each one. Where it falls off the edge, that's a gap.
          </motion.p>
          <motion.p {...fade}>
            The shape of the gap constrains what fills it. You don't invent. You
            fill along gravity.
          </motion.p>
          <motion.p {...fade} className="text-[var(--color-dim)] text-base">
            Complete when every vision sentence traces without falling off and
            every leaf is collapsed or in declared superposition.
          </motion.p>
        </div>
      </Section>

      {/* Divider */}
      <div className="my-16 border-t border-[var(--color-faint)]" />

      {/* 6. The Fixed Point */}
      <Section className="items-center text-center">
        <motion.p
          {...fade}
          className="text-2xl md:text-3xl font-light leading-relaxed max-w-lg"
        >
          The spec, the method, and the language are the same shape.
        </motion.p>
      </Section>

      {/* Divider */}
      <div className="my-16 border-t border-[var(--color-faint)]" />

      {/* 7. Worked Example */}
      <Section>
        <h2 className="text-2xl md:text-3xl font-light mb-12 text-[var(--color-dim)]">
          Worked Example
        </h2>
        <div className="space-y-6 text-lg leading-relaxed">
          <motion.p {...fade}>
            This method was used to specify the tool that implements it.
          </motion.p>
          <motion.p {...fade}>
            <a
              ref={specLinkRef}
              href="#/viewer"
              className="underline underline-offset-4 decoration-[var(--color-faint)] hover:decoration-[var(--color-bone)] transition-colors"
            >
              The interactive spec
            </a>{" "}
            is the worked example — and the prompt for the Design Partner.
          </motion.p>
          <motion.p {...fade}>
            <a
              href="https://github.com/gitlevich/sigil"
              target="_blank"
              rel="noopener"
              className="underline underline-offset-4 decoration-[var(--color-faint)] hover:decoration-[var(--color-bone)] transition-colors"
            >
              The repo
            </a>{" "}
            is the code — a projection of that spec.
          </motion.p>
          <motion.p {...fade}>
            <a
              href="https://github.com/gitlevich/sigil/releases"
              target="_blank"
              rel="noopener"
              className="underline underline-offset-4 decoration-[var(--color-faint)] hover:decoration-[var(--color-bone)] transition-colors"
            >
              The app
            </a>{" "}
            is downloadable.
          </motion.p>
        </div>
      </Section>

      {/* Divider */}
      <div className="my-16 border-t border-[var(--color-faint)]" />

      {/* 8. Closing */}
      <Section>
        <div className="space-y-6 text-lg leading-relaxed">
          <motion.p {...fade}>
            Any domain. Anyone who knows what they want and is willing to narrate
            it.
          </motion.p>
          <motion.p {...fade}>Spec in, working system out.</motion.p>
        </div>
      </Section>

      {/* Footer */}
      <footer className="mt-32 mb-16 text-center text-sm text-[var(--color-dim)]">
        <motion.p {...fade}>sigilengineering.com</motion.p>
      </footer>
    </main>
  );
}

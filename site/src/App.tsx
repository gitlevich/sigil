import { useEffect, useRef, useState } from "react";
import { motion, type Easing } from "framer-motion";
import "./App.css";
import { landingContent } from "./landingContent";
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
    <motion.section {...fade} className={`landing-section ${className}`}>
      {children}
    </motion.section>
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
    <main className="site-shell">
      <div className="site-orbit site-orbit-one" aria-hidden="true" />
      <div className="site-orbit site-orbit-two" aria-hidden="true" />

      <Section className="hero-section">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease }}
          className="eyebrow"
        >
          {landingContent.hero.kicker}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.1, ease }}
          className="hero-title"
        >
          {landingContent.hero.title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.25, ease }}
          className="hero-lede"
        >
          {landingContent.hero.lede}
        </motion.p>
      </Section>

      <Section className="story-section">
        <div className="section-rule" aria-hidden="true" />
        <article className="story-block">
          {landingContent.story.map((paragraph, index) => (
            <motion.p
              key={paragraph}
              {...fade}
              className={index === 0 ? "story-lead" : undefined}
            >
              {paragraph}
            </motion.p>
          ))}
        </article>
      </Section>

      <Section className="quote-section">
        <motion.p {...fade} className="pull-quote">
          {landingContent.pullQuote}
        </motion.p>
      </Section>

      <Section className="implementation-section">
        <div className="section-rule" aria-hidden="true" />
        <div className="section-heading">
          <p className="eyebrow">{landingContent.implementation.label}</p>
          <h2>{landingContent.implementation.title}</h2>
        </div>

        <div className="story-block">
          {landingContent.implementation.paragraphs.map((paragraph) => (
            <motion.p key={paragraph} {...fade}>
              {paragraph}
            </motion.p>
          ))}
        </div>
      </Section>

      <Section className="links-section">
        <div className="section-rule" aria-hidden="true" />
        <div className="section-heading">
          <p className="eyebrow">{landingContent.links.label}</p>
          <h2>{landingContent.links.title}</h2>
        </div>

        <div className="links-grid">
          {landingContent.links.items.map((item) => {
            const isViewerLink = item.href === "#/viewer";
            return (
              <motion.a
                key={item.title}
                {...fade}
                ref={isViewerLink ? specLinkRef : undefined}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="link-card"
              >
                <p className="link-eyebrow">{item.eyebrow}</p>
                <h3>{item.title}</h3>
                <p className="link-description">{item.description}</p>
                <span className="link-action">{item.action}</span>
              </motion.a>
            );
          })}
        </div>
      </Section>

      <footer className="landing-footer">
        <motion.p {...fade}>{landingContent.footer}</motion.p>
      </footer>
    </main>
  );
}

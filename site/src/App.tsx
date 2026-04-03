import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion, type Easing } from "framer-motion";
import "./App.css";
import {
  CONTACT_AJAX_URL,
  CONTACT_EMAIL,
  CONTACT_POST_URL,
  buildContactRequest,
} from "./contact";
import { landingContent } from "./landingContent";
import { SigilViewer } from "./viewer/SigilViewer";

const ease: Easing = "easeOut";

type ContactStatus = "idle" | "submitting" | "success" | "error";

function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`landing-section ${className}`}>
      {children}
    </section>
  );
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [contactStatus, setContactStatus] = useState<ContactStatus>("idle");
  const [contactMessage, setContactMessage] = useState<string | null>(null);
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

  const handleContactSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const payload = buildContactRequest(new FormData(form));
    const honey = payload.get("_honey")?.toString().trim();

    if (honey) {
      form.reset();
      setContactStatus("success");
      setContactMessage(landingContent.contact.success);
      return;
    }

    setContactStatus("submitting");
    setContactMessage(null);

    try {
      const response = await fetch(CONTACT_AJAX_URL, {
        method: "POST",
        body: payload,
        headers: {
          Accept: "application/json",
        },
      });

      const result = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      if (!response.ok) {
        throw new Error(result?.message ?? "Unable to send message.");
      }

      form.reset();
      setContactStatus("success");
      setContactMessage(landingContent.contact.success);
    } catch {
      setContactStatus("error");
      setContactMessage(landingContent.contact.error);
    }
  };

  if (hash.startsWith("#/viewer")) {
    return <SigilViewer />;
  }

  return (
    <main className="site-shell">
      <div className="site-orbit site-orbit-one" aria-hidden="true" />
      <div className="site-orbit site-orbit-two" aria-hidden="true" />

      <Section className="hero-section">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease }}
          className="hero-brand"
        >
          <img src="/favicon.svg" alt="" aria-hidden="true" className="hero-logo" />
          <p className="eyebrow">{landingContent.hero.kicker}</p>
        </motion.div>
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
            <p key={paragraph} className={index === 0 ? "story-lead" : undefined}>
              {paragraph}
            </p>
          ))}
        </article>
      </Section>

      <Section className="quote-section">
        <p className="pull-quote">{landingContent.pullQuote}</p>
      </Section>

      <Section className="implementation-section">
        <div className="section-rule" aria-hidden="true" />
        <div className="section-heading">
          <p className="eyebrow">{landingContent.implementation.label}</p>
          <h2>{landingContent.implementation.title}</h2>
        </div>

        <div className="story-block">
          {landingContent.implementation.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Section>

      <Section className="links-section">
        <div className="section-rule" aria-hidden="true" />
        <div className="section-heading">
          <p className="eyebrow">{landingContent.links.label}</p>
          <h2>{landingContent.links.title}</h2>
        </div>
        <p className="section-intro">{landingContent.links.intro}</p>

        <div className="links-grid">
          {landingContent.links.items.map((item) => {
            const isViewerLink = item.href === "#/viewer";
            return (
              <a
                key={item.title}
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
              </a>
            );
          })}
        </div>
      </Section>

      <Section className="contact-section" id="contact">
        <div className="section-rule" aria-hidden="true" />
        <div className="section-heading">
          <p className="eyebrow">{landingContent.contact.label}</p>
          <h2>{landingContent.contact.title}</h2>
        </div>

        <div className="contact-stack">
          <p className="contact-intro">{landingContent.contact.lede}</p>

          <form
            action={CONTACT_POST_URL}
            method="POST"
            className="contact-form"
            onSubmit={handleContactSubmit}
          >
            <input type="hidden" name="_subject" value="Sigil Engineering inquiry" />
            <input type="hidden" name="_template" value="table" />

            <div className="contact-row">
              <label className="contact-field">
                <span>Name</span>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  required
                  placeholder="Your name"
                />
              </label>

              <label className="contact-field">
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
              </label>
            </div>

            <label className="contact-field">
              <span>Message</span>
              <textarea
                name="message"
                rows={6}
                required
                placeholder="What are you trying to build, or what would you like to talk about?"
              />
            </label>

            <label className="contact-honey" aria-hidden="true">
              <span>Leave this field empty</span>
              <input type="text" name="_honey" tabIndex={-1} autoComplete="off" />
            </label>

            <div className="contact-submit-row">
              <button
                type="submit"
                className="contact-submit"
                disabled={contactStatus === "submitting"}
              >
                {contactStatus === "submitting"
                  ? landingContent.contact.buttonSending
                  : landingContent.contact.buttonIdle}
              </button>

              <p
                className={`contact-status ${
                  contactStatus === "success"
                    ? "contact-status-success"
                    : contactStatus === "error"
                      ? "contact-status-error"
                      : ""
                }`}
                aria-live="polite"
              >
                {contactMessage}
              </p>
            </div>
          </form>

          <p className="contact-direct">
            {landingContent.contact.directLabel}{" "}
            <a href={`mailto:${CONTACT_EMAIL}?subject=Sigil%20Engineering`}>
              {landingContent.contact.directAction}
            </a>
          </p>
        </div>
      </Section>

      <footer className="landing-footer">
        <p>{landingContent.footer}</p>
      </footer>
    </main>
  );
}

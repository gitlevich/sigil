import { useEffect, useRef, useState, type FormEvent } from "react";
import "./App.css";
import {
  CONTACT_AJAX_URL,
  CONTACT_EMAIL,
  CONTACT_POST_URL,
  buildContactRequest,
} from "./contact";
import { Essay } from "./Essay";
import { landingContent } from "./landingContent";
import { SigilViewer } from "./viewer/SigilViewer";

type ContactStatus = "idle" | "submitting" | "success" | "error";

// Renders [label](href) markdown links inside prose strings from landing.md.
function Prose({ text }: { text: string }) {
  const parts = text.split(/\[([^\]]+)\]\(([^)]+)\)/g);
  if (parts.length === 1) {
    return text;
  }
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    nodes.push(parts[i]);
    if (i + 2 < parts.length) {
      nodes.push(
        <a key={i} href={parts[i + 2]}>
          {parts[i + 1]}
        </a>,
      );
    }
  }
  return nodes;
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

  if (hash.startsWith("#/sigil")) {
    return <Essay />;
  }

  return (
    <div className="landing">
      <main className="site-shell">
        <header className="hero">
          <div className="hero-brand">
            <img src="/favicon.svg" alt="" aria-hidden="true" className="hero-logo" />
            <p className="brand-label">{landingContent.hero.kicker}</p>
          </div>
          <h1 className="hero-title">{landingContent.hero.title}</h1>
          <p className="hero-lede">{landingContent.hero.lede}</p>
        </header>

        <section className="prose-section">
          <hr className="rule" />
          <article className="story-block">
            {landingContent.story.map((paragraph, index) => (
              <p key={paragraph} className={index === 0 ? "story-lead" : undefined}>
                <Prose text={paragraph} />
              </p>
            ))}
          </article>
        </section>

        <section className="quote-section">
          <span className="dinkus" aria-hidden="true">
            ⁂
          </span>
          <p className="pull-quote">{landingContent.pullQuote}</p>
        </section>

        <section className="prose-section">
          <hr className="rule" />
          <header className="section-heading">
            <p className="eyebrow">{landingContent.implementation.label}</p>
            <h2>{landingContent.implementation.title}</h2>
          </header>
          <div className="story-block">
            {landingContent.implementation.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section className="prose-section">
          <hr className="rule" />
          <header className="section-heading">
            <p className="eyebrow">{landingContent.links.label}</p>
            <h2>{landingContent.links.title}</h2>
          </header>
          <p className="section-intro">{landingContent.links.intro}</p>

          <nav className="links-index">
            {landingContent.links.items.map((item) => {
              const isViewerLink = item.href === "#/viewer";
              return (
                <a
                  key={item.title}
                  ref={isViewerLink ? specLinkRef : undefined}
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  className="index-row"
                >
                  <span className="row-eyebrow">{item.eyebrow}</span>
                  <span className="row-body">
                    <span className="row-title">{item.title}</span>
                    <span className="row-desc">{item.description}</span>
                  </span>
                  <span className="row-action">{item.action}</span>
                </a>
              );
            })}
          </nav>
        </section>

        <section className="prose-section" id="contact">
          <hr className="rule" />
          <header className="section-heading">
            <p className="eyebrow">{landingContent.contact.label}</p>
            <h2>{landingContent.contact.title}</h2>
          </header>

          <div className="contact-stack">
            <p className="section-intro">{landingContent.contact.lede}</p>

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
        </section>

        <footer className="colophon">
          <p>{landingContent.footer}</p>
        </footer>
      </main>
    </div>
  );
}

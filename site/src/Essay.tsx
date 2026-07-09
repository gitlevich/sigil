import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import essaySource from "./what-is-a-sigil.md?raw";

export function Essay() {
  useEffect(() => {
    document.scrollingElement?.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="landing">
      <main className="site-shell">
        <nav className="essay-return">
          <a href="#/">← Sigil Engineering</a>
        </nav>
        <article className="essay-body">
          <ReactMarkdown>{essaySource}</ReactMarkdown>
        </article>
        <footer className="colophon">
          <p>sigilengineering.com</p>
        </footer>
      </main>
    </div>
  );
}

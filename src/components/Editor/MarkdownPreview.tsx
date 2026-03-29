import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownPreview.module.css";

interface MarkdownPreviewProps {
  content: string;
  siblingNames?: string[];
}

export function MarkdownPreview({ content, siblingNames = [] }: MarkdownPreviewProps) {
  // Build a regex to match sibling names (with optional .affordance)
  const siblingPattern = useMemo(() => {
    if (siblingNames.length === 0) return null;
    const escaped = siblingNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`\\b(${escaped.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`, "gi");
  }, [siblingNames]);

  return (
    <div className={styles.preview}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={siblingPattern ? {
          // Override text rendering to highlight sibling references
          text: ({ children }) => {
            if (typeof children !== "string") return <>{children}</>;
            return <>{highlightSiblings(children, siblingPattern)}</>;
          },
          p: ({ children, ...props }) => (
            <p {...props}>{highlightChildStrings(children, siblingPattern)}</p>
          ),
          li: ({ children, ...props }) => (
            <li {...props}>{highlightChildStrings(children, siblingPattern)}</li>
          ),
        } : undefined}
      >{content}</ReactMarkdown>
    </div>
  );
}

function highlightSiblings(text: string, pattern: RegExp): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className="sibling-ref">{match[0]}</span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function highlightChildStrings(children: React.ReactNode, pattern: RegExp): React.ReactNode {
  if (typeof children === "string") {
    return <>{highlightSiblings(children, pattern)}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{highlightSiblings(child, pattern)}</span>;
      }
      return child;
    });
  }
  return children;
}

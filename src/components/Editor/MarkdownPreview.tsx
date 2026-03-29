import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownPreview.module.css";

export interface SiblingInfo {
  name: string;
  summary: string;
}

interface MarkdownPreviewProps {
  content: string;
  siblingNames?: string[];
  siblings?: SiblingInfo[];
}

export function MarkdownPreview({ content, siblingNames = [], siblings = [] }: MarkdownPreviewProps) {
  const siblingPattern = useMemo(() => {
    if (siblingNames.length === 0) return null;
    const escaped = siblingNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`@(${escaped.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`, "gi");
  }, [siblingNames]);

  const summaryMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of siblings) {
      map[s.name.toLowerCase()] = s.summary;
    }
    return map;
  }, [siblings]);

  return (
    <div className={styles.preview}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={siblingPattern ? {
          text: ({ children }) => {
            if (typeof children !== "string") return <>{children}</>;
            return <>{highlightSiblings(children, siblingPattern, summaryMap)}</>;
          },
          p: ({ children, ...props }) => (
            <p {...props}>{highlightChildStrings(children, siblingPattern, summaryMap)}</p>
          ),
          li: ({ children, ...props }) => (
            <li {...props}>{highlightChildStrings(children, siblingPattern, summaryMap)}</li>
          ),
        } : undefined}
      >{content}</ReactMarkdown>
    </div>
  );
}

function highlightSiblings(
  text: string,
  pattern: RegExp,
  summaryMap: Record<string, string>
): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const baseName = match[1]; // the sibling name without .affordance
    const summary = summaryMap[baseName.toLowerCase()];
    parts.push(
      <span
        key={match.index}
        className="sibling-ref"
        title={summary || baseName}
      >
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function highlightChildStrings(
  children: React.ReactNode,
  pattern: RegExp,
  summaryMap: Record<string, string>
): React.ReactNode {
  if (typeof children === "string") {
    return <>{highlightSiblings(children, pattern, summaryMap)}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{highlightSiblings(child, pattern, summaryMap)}</span>;
      }
      return child;
    });
  }
  return children;
}

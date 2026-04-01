import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownPreview.module.css";

export interface SiblingInfo {
  name: string;
  summary: string;
  kind?: "contained" | "sibling" | "lib";
}

interface MarkdownPreviewProps {
  content: string;
  siblingNames?: string[];
  siblings?: SiblingInfo[];
}

type RefMap = Record<string, { summary: string; kind: string }>;

export function MarkdownPreview({ content, siblingNames = [], siblings = [] }: MarkdownPreviewProps) {
  const siblingPattern = useMemo(() => {
    if (siblingNames.length === 0) return null;
    const escaped = siblingNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`@(${escaped.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`, "gi");
  }, [siblingNames]);

  const refMap = useMemo<RefMap>(() => {
    const map: RefMap = {};
    for (const s of siblings) {
      map[s.name.toLowerCase()] = { summary: s.summary, kind: s.kind || "contained" };
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
            return <>{highlightRefs(children, siblingPattern, refMap)}</>;
          },
          p: ({ children, ...props }) => (
            <p {...props}>{highlightChildStrings(children, siblingPattern, refMap)}</p>
          ),
          li: ({ children, ...props }) => (
            <li {...props}>{highlightChildStrings(children, siblingPattern, refMap)}</li>
          ),
        } : undefined}
      >{content}</ReactMarkdown>
    </div>
  );
}

function highlightRefs(text: string, pattern: RegExp, refMap: RefMap): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const baseName = match[1];
    const info = refMap[baseName.toLowerCase()];
    const className = info?.kind === "sibling" ? "ref-sibling" : "ref-contained";
    parts.push(
      <span
        key={match.index}
        className={className}
        title={info?.summary || baseName}
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

function highlightChildStrings(children: React.ReactNode, pattern: RegExp, refMap: RefMap): React.ReactNode {
  if (typeof children === "string") {
    return <>{highlightRefs(children, pattern, refMap)}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{highlightRefs(child, pattern, refMap)}</span>;
      }
      return child;
    });
  }
  return children;
}

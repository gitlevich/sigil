import { useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Ref } from "./utils";
import { resolveRefName, stripFrontmatter } from "sigil-core";
import styles from "./MarkdownPreview.module.css";

const STYLE_FOR_PREFIX: Record<string, string> = {
  "@": "ref-context",
  "#": "ref-affordance",
  "!": "ref-invariant",
};

function RefSpan({
  text,
  className,
  summary,
  onClick,
}: {
  text: string;
  className: string;
  summary: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const showPopover = useCallback(() => {
    setHovered(true);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = Math.min(500, window.innerWidth * 0.8);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
      const top = rect.bottom + 6;
      setPos({ top, left });
    }
  }, []);

  return (
    <span
      className={styles.refWrapper}
      ref={triggerRef}
      onMouseEnter={showPopover}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className={`${className} ${onClick ? styles.clickableRef : ""}`}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      >
        {text}
      </span>
      {hovered && summary && pos && createPortal(
        <span
          className={styles.refPopover}
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={showPopover}
          onMouseLeave={() => setHovered(false)}
        >
          {summary}
        </span>,
        triggerRef.current?.closest(".sigil-viewer") ?? document.body
      )}
    </span>
  );
}

interface MarkdownPreviewProps {
  content: string;
  refs: Ref[];
  onNavigate?: (name: string) => void;
}

type RefLookup = Record<string, Ref>;

export function MarkdownPreview({
  content,
  refs,
  onNavigate,
}: MarkdownPreviewProps) {
  const pattern = useMemo(() => {
    if (refs.length === 0) return null;
    const escaped = refs.map((r) =>
      r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    // Deduplicate names (same name may appear with different prefixes)
    const unique = [...new Set(escaped)];
    // Also generate inflected forms: -ed (past), -ing (continuous), -s (plural), -d (silent-e past)
    const inflected: string[] = [];
    for (const name of unique) {
      inflected.push(name);
      // e-ending verbs: Collapse → Collapsed, Collapsing
      if (/e$/i.test(name)) {
        inflected.push(name + "d");        // Collapsed
        inflected.push(name.slice(0, -1) + "ing"); // Collapsing
      } else {
        inflected.push(name + "ed");       // Attended
        inflected.push(name + "ing");      // Attending
      }
      inflected.push(name + "s");          // Collapses
    }
    const uniqueInflected = [...new Set(inflected)];
    return new RegExp(
      `([@#!])(${uniqueInflected.join("|")})(\\.[a-zA-Z_][a-zA-Z0-9_]*)?\\b`,
      "gi"
    );
  }, [refs]);

  const lookup = useMemo<RefLookup>(() => {
    const map: RefLookup = {};
    for (const r of refs) {
      map[`${r.prefix}${r.name.toLowerCase()}`] = r;
      // Add inflected forms pointing to same ref
      const name = r.name.toLowerCase();
      if (name.endsWith("e")) {
        map[`${r.prefix}${name}d`] = r;
        map[`${r.prefix}${name.slice(0, -1)}ing`] = r;
      } else {
        map[`${r.prefix}${name}ed`] = r;
        map[`${r.prefix}${name}ing`] = r;
      }
      map[`${r.prefix}${name}s`] = r;
    }
    return map;
  }, [refs]);

  const stripped = useMemo(() => stripFrontmatter(content), [content]);

  return (
    <div className={styles.preview}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={
          pattern
            ? {
                p: ({ children, ...props }) => (
                  <p {...props}>
                    {highlightChildStrings(children, pattern, lookup, onNavigate)}
                  </p>
                ),
                li: ({ children, ...props }) => (
                  <li {...props}>
                    {highlightChildStrings(children, pattern, lookup, onNavigate)}
                  </li>
                ),
              }
            : undefined
        }
      >
        {stripped}
      </ReactMarkdown>
    </div>
  );
}

function highlightRefs(
  text: string,
  pattern: RegExp,
  lookup: RefLookup,
  onNavigate?: (name: string) => void
): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const prefix = match[1];
    const name = match[2];
    const ref = lookup[`${prefix}${name.toLowerCase()}`];
    if (!ref) {
      parts.push(match[0]);
      lastIndex = match.index + match[0].length;
      continue;
    }
    const className = STYLE_FOR_PREFIX[prefix] || "ref-context";
    parts.push(
      <RefSpan
        key={match.index}
        text={match[0]}
        className={className}
        summary={ref.summary}
        onClick={ref.navigable && onNavigate ? () => onNavigate(ref.navigateTo ?? name) : undefined}
      />
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
  lookup: RefLookup,
  onNavigate?: (name: string) => void
): React.ReactNode {
  if (typeof children === "string") {
    return <>{highlightRefs(children, pattern, lookup, onNavigate)}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{highlightRefs(child, pattern, lookup, onNavigate)}</span>;
      }
      return child;
    });
  }
  return children;
}

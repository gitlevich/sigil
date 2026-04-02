import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  stripFrontmatter,
  buildRefPattern,
  buildRefLookup,
  highlightText,
  type Ref,
  type Segment,
} from "sigil-core";
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

/** Convert SiblingInfo[] to Ref[] so the shared highlighting can consume them. */
function siblingsToRefs(siblings: SiblingInfo[]): Ref[] {
  return siblings.map((s) => ({
    name: s.name,
    prefix: "@" as const,
    summary: s.summary,
    navigable: false,
    navigateTo: undefined,
  }));
}

export function MarkdownPreview({ content, siblings = [] }: MarkdownPreviewProps) {
  const refs = useMemo(() => siblingsToRefs(siblings), [siblings]);
  const pattern = useMemo(() => buildRefPattern(refs), [refs]);
  const lookup = useMemo(() => buildRefLookup(refs), [refs]);
  const stripped = useMemo(() => stripFrontmatter(content), [content]);

  // Build a kind map for CSS class differentiation (contained vs sibling vs lib)
  const kindMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of siblings) {
      map[s.name.toLowerCase()] = s.kind || "contained";
    }
    return map;
  }, [siblings]);

  return (
    <div className={styles.preview}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={pattern ? {
          p: ({ children, ...props }) => (
            <p {...props}>{highlightChildStrings(children, pattern, lookup, kindMap)}</p>
          ),
          li: ({ children, ...props }) => (
            <li {...props}>{highlightChildStrings(children, pattern, lookup, kindMap)}</li>
          ),
        } : undefined}
      >{stripped}</ReactMarkdown>
    </div>
  );
}

function renderSegments(
  segments: Segment[],
  baseKey: number,
  kindMap: Record<string, string>
): React.ReactNode[] {
  return segments.map((seg, i) => {
    if (seg.kind === "text") return seg.text;
    // Use contained/sibling/lib CSS classes for the Tauri app's styling
    const refName = seg.ref.name.toLowerCase();
    const kind = kindMap[refName] || "contained";
    const className = kind === "sibling" ? "ref-sibling" : kind === "lib" ? "ref-lib" : "ref-contained";
    return (
      <span
        key={baseKey + i}
        className={className}
        title={seg.ref.summary}
      >
        {seg.text}
      </span>
    );
  });
}

function highlightChildStrings(
  children: React.ReactNode,
  pattern: RegExp,
  lookup: Record<string, Ref>,
  kindMap: Record<string, string>
): React.ReactNode {
  if (typeof children === "string") {
    return <>{renderSegments(highlightText(children, pattern, lookup), 0, kindMap)}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{renderSegments(highlightText(child, pattern, lookup), i * 1000, kindMap)}</span>;
      }
      return child;
    });
  }
  return children;
}

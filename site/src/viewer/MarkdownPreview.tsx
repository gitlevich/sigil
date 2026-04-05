import { useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Ref } from "./utils";
import {
  stripFrontmatter,
  buildRefPattern,
  buildRefLookup,
  highlightText,
  styleForPrefix,
  type Segment,
} from "sigil-core";
import styles from "./MarkdownPreview.module.css";

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

export function MarkdownPreview({
  content,
  refs,
  onNavigate,
}: MarkdownPreviewProps) {
  const pattern = useMemo(() => buildRefPattern(refs), [refs]);
  const lookup = useMemo(() => buildRefLookup(refs), [refs]);
  const stripped = useMemo(() => stripFrontmatter(content), [content]);

  return (
    <div className={styles.preview}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          ...(pattern
            ? {
                p: ({ children, ...props }: Record<string, unknown>) => (
                  <p {...(props as React.HTMLAttributes<HTMLParagraphElement>)}>
                    {highlightChildStrings(children as React.ReactNode, pattern, lookup, onNavigate)}
                  </p>
                ),
                li: ({ children, ...props }: Record<string, unknown>) => (
                  <li {...(props as React.HTMLAttributes<HTMLLIElement>)}>
                    {highlightChildStrings(children as React.ReactNode, pattern, lookup, onNavigate)}
                  </li>
                ),
              }
            : {}),
          img: ({ src, alt, width, ...props }: Record<string, unknown>) => {
            const style: React.CSSProperties = { maxWidth: "100%", height: "auto", borderRadius: 4 };
            if (width) style.width = typeof width === "number" ? `${width}px` : String(width);
            return <img src={src as string} alt={(alt as string) ?? ""} style={style} {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />;
          },
        }}
      >
        {stripped}
      </ReactMarkdown>
    </div>
  );
}

function renderSegments(
  segments: Segment[],
  baseKey: number,
  onNavigate?: (name: string) => void
): React.ReactNode[] {
  return segments.map((seg, i) => {
    if (seg.kind === "text") return seg.text;
    return (
      <RefSpan
        key={baseKey + i}
        text={seg.text}
        className={styleForPrefix(seg.prefix)}
        summary={seg.ref.summary}
        onClick={seg.ref.navigable && onNavigate ? () => onNavigate(seg.navigateTo!) : undefined}
      />
    );
  });
}

function highlightChildStrings(
  children: React.ReactNode,
  pattern: RegExp,
  lookup: Record<string, Ref>,
  onNavigate?: (name: string) => void
): React.ReactNode {
  if (typeof children === "string") {
    return <>{renderSegments(highlightText(children, pattern, lookup), 0, onNavigate)}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{renderSegments(highlightText(child, pattern, lookup), i * 1000, onNavigate)}</span>;
      }
      return child;
    });
  }
  return children;
}

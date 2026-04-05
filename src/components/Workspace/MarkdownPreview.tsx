import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  stripFrontmatter,
  buildRefPattern,
  buildRefLookup,
  highlightText,
  styleForPrefix,
  type Ref,
  type Segment,
} from "sigil-core";
import { api } from "../../tauri";
import styles from "./MarkdownPreview.module.css";

export interface SiblingInfo {
  name: string;
  summary: string;
  kind?: "contained" | "sibling" | "lib";
}

interface MarkdownPreviewProps {
  content: string;
  refs?: Ref[];
  sigilDir?: string;
  images?: string[];
  onContentChange?: (content: string) => void;
  /** @deprecated Use refs instead */
  siblingNames?: string[];
  /** @deprecated Use refs instead */
  siblings?: SiblingInfo[];
}

function ResizableImage({
  src,
  alt,
  width: initialWidth,
  sigilDir,
  onResize,
}: {
  src?: string;
  alt?: string;
  width?: number;
  sigilDir?: string;
  onResize?: (src: string, width: number) => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState<number | undefined>(initialWidth);
  const imgRef = useRef<HTMLImageElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    if (!src || !sigilDir) return;
    // Resolve relative paths against sigilDir
    const fullPath = src.startsWith("/") ? src : `${sigilDir}/${src}`;
    api.readImageBase64(fullPath).then(setDataUrl).catch(() => setError(true));
  }, [src, sigilDir]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = imgRef.current?.offsetWidth ?? 200;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      setWidth(Math.max(64, startWidthRef.current + delta));
    };
    const handleUp = (e: MouseEvent) => {
      setDragging(false);
      const finalWidth = Math.max(64, startWidthRef.current + (e.clientX - startXRef.current));
      setWidth(finalWidth);
      if (onResize && src) onResize(src, finalWidth);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, onResize, src]);

  if (error || !src) {
    return <span className={styles.imagePlaceholder}>{alt || "image"}</span>;
  }

  if (!dataUrl) {
    return <span className={styles.imageLoading} style={{ width: width ?? 200, height: 100 }} />;
  }

  return (
    <span className={styles.imageContainer}>
      <img
        ref={imgRef}
        src={dataUrl}
        alt={alt ?? ""}
        style={{ width: width ? `${width}px` : undefined, maxWidth: "100%", height: "auto" }}
      />
      {onResize && (
        <span className={styles.resizeHandle} onMouseDown={handleMouseDown} />
      )}
    </span>
  );
}

function SigilImage({ path }: { path: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    api.readImageBase64(path).then(setDataUrl).catch(() => {});
  }, [path]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt="" className={styles.sigilImage} />;
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

export function MarkdownPreview({ content, refs: refsProp, sigilDir, images = [], onContentChange, siblings = [] }: MarkdownPreviewProps) {
  const refs = useMemo(
    () => refsProp ?? siblingsToRefs(siblings),
    [refsProp, siblings],
  );
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

  const handleImageResize = useCallback((src: string, width: number) => {
    if (!onContentChange) return;
    // Replace ![...](src) or <img src="src" width="..."> with updated width
    const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match markdown image syntax
    const mdPattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedSrc}\\)`);
    // Match HTML img tag
    const htmlPattern = new RegExp(`<img\\s+src="${escapedSrc}"\\s+width="\\d+px"\\s*/>`);
    const replacement = `<img src="${src}" width="${width}px" />`;
    let updated = content;
    if (htmlPattern.test(content)) {
      updated = content.replace(htmlPattern, replacement);
    } else if (mdPattern.test(content)) {
      updated = content.replace(mdPattern, replacement);
    }
    if (updated !== content) onContentChange(updated);
  }, [content, onContentChange]);

  const components: Record<string, React.ComponentType<Record<string, unknown>>> = useMemo(() => {
    const base: Record<string, React.ComponentType<Record<string, unknown>>> = {};
    if (pattern) {
      base.p = ({ children, ...props }: Record<string, unknown>) => (
        <p {...props}>{highlightChildStrings(children as React.ReactNode, pattern, lookup, kindMap)}</p>
      );
      base.li = ({ children, ...props }: Record<string, unknown>) => (
        <li {...props}>{highlightChildStrings(children as React.ReactNode, pattern, lookup, kindMap)}</li>
      );
    }
    if (sigilDir) {
      base.img = ({ src, alt, width: w, ...props }: Record<string, unknown>) => {
        const numWidth = typeof w === "string" ? parseInt(w, 10) : typeof w === "number" ? w : undefined;
        return (
          <ResizableImage
            src={src as string}
            alt={alt as string}
            width={numWidth}
            sigilDir={sigilDir}
            onResize={onContentChange ? handleImageResize : undefined}
            {...props}
          />
        );
      };
    }
    return base;
  }, [pattern, lookup, kindMap, sigilDir, onContentChange, handleImageResize]);

  return (
    <div className={styles.preview}>
      {images.length > 0 && (
        <div className={styles.sigilImages}>
          {images.map((imgPath) => (
            <SigilImage key={imgPath} path={imgPath} />
          ))}
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
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
    // For # and ! refs (including compound like @Chat#branch), use prefix-based styling
    // For @ refs, use contained/sibling/lib CSS classes
    let className: string;
    if (seg.prefix === "#" || seg.prefix === "!") {
      className = styleForPrefix(seg.prefix);
    } else {
      const refName = seg.ref.name.toLowerCase();
      const kind = kindMap[refName] || "contained";
      className = kind === "sibling" ? "ref-sibling" : kind === "lib" ? "ref-lib" : "ref-contained";
    }
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

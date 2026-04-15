/**
 * MemoriesPanel — two-layer memory visualization.
 *
 * Top: short-term (recent traces, zoomed in, warm tones)
 * Bottom: long-term (consolidated, zoomed out, cool tones)
 * Both zoomable. Shared detail panel.
 */
import { useState, useEffect, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useExperience } from "../../state/ExperienceContext";
import type { RememberedSigil, ShortTermTrace } from "sigil-core/memory";
import styles from "./MemoriesPanel.module.css";

interface GraphNode {
  id: string;
  name: string;
  weight: number;
  affordances: string[];
  invariants: string[];
}

interface GraphLink {
  source: string;
  target: string;
  count: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

type DetailItem =
  | { kind: "node"; node: GraphNode; layer: "short" | "long" }
  | { kind: "edge"; link: GraphLink; layer: "short" | "long" };

function buildGraphFromRemembered(entries: RememberedSigil[]): GraphData {
  const names = new Set(entries.map(r => r.name));
  const nodes: GraphNode[] = entries.map(r => ({
    id: r.name, name: r.name, weight: r.weight,
    affordances: r.vocabulary.affordances, invariants: r.vocabulary.invariants,
  }));

  const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const edgeMap = new Map<string, GraphLink>();
  for (const r of entries) {
    for (const e of r.edges) {
      if (!names.has(e.target)) continue;
      const key = edgeKey(r.name, e.target);
      if (!edgeMap.has(key)) edgeMap.set(key, { source: r.name, target: e.target, count: e.count });
    }
  }

  return { nodes, links: [...edgeMap.values()] };
}

function buildGraphFromTraces(traces: ShortTermTrace[]): GraphData {
  // Deduplicate: keep latest trace per name
  const byName = new Map<string, ShortTermTrace>();
  for (const t of traces) byName.set(t.name, t);
  const unique = [...byName.values()];

  const names = new Set(unique.map(t => t.name));
  const nodes: GraphNode[] = unique.map(t => ({
    id: t.name, name: t.name, weight: 1.0,
    affordances: t.vocabulary.affordances, invariants: t.vocabulary.invariants,
  }));

  const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const edgeMap = new Map<string, GraphLink>();
  for (const t of unique) {
    for (const e of t.edges) {
      if (!names.has(e.target)) continue;
      const key = edgeKey(t.name, e.target);
      if (!edgeMap.has(key)) edgeMap.set(key, { source: t.name, target: e.target, count: e.count });
    }
  }

  return { nodes, links: [...edgeMap.values()] };
}

export function MemoriesPanel() {
  const { getMemory } = useExperience();
  const [shortGraph, setShortGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [longGraph, setLongGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [detail, setDetail] = useState<DetailItem | null>(null);

  useEffect(() => {
    const update = () => {
      const mem = getMemory();
      setShortGraph(buildGraphFromTraces(mem.shortTerm));
      setLongGraph(buildGraphFromRemembered([...mem.longTerm.values()].filter(r => r.weight >= 0.1)));
    };
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [getMemory]);

  const isEmpty = shortGraph.nodes.length === 0 && longGraph.nodes.length === 0;

  return (
    <div className={styles.container}>
      {isEmpty ? (
        <div className={styles.empty}>No memories yet. Edit sigils to build remembered positions.</div>
      ) : (
        <>
          <div className={styles.layerSection}>
            <div className={styles.layerLabel}>Short-term</div>
            <div className={styles.graphContainer}>
              {shortGraph.nodes.length === 0 ? (
                <div className={styles.layerEmpty}>No recent traces</div>
              ) : (
                <MemoryGraph graph={shortGraph} layer="short" onDetail={setDetail} />
              )}
            </div>
          </div>
          <div className={styles.divider} />
          <div className={styles.layerSection}>
            <div className={styles.layerLabel}>Long-term</div>
            <div className={styles.graphContainer}>
              {longGraph.nodes.length === 0 ? (
                <div className={styles.layerEmpty}>No consolidated memories</div>
              ) : (
                <MemoryGraph graph={longGraph} layer="long" onDetail={setDetail} />
              )}
            </div>
          </div>
        </>
      )}
      {detail && (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <strong>{detailTitle(detail)}</strong>
            <button className={styles.closeBtn} onClick={() => setDetail(null)}>&times;</button>
          </div>
          <div className={styles.detailBody}>{detailBody(detail)}</div>
        </div>
      )}
    </div>
  );
}

function detailTitle(d: DetailItem): string {
  if (d.kind === "node") return `${d.node.name} (${d.node.weight.toFixed(2)})`;
  return `${d.link.source} \u2194 ${d.link.target}`;
}

function detailBody(d: DetailItem): string {
  if (d.kind === "node") {
    return [
      d.node.affordances.length > 0 ? `Affordances: ${d.node.affordances.join(", ")}` : null,
      d.node.invariants.length > 0 ? `Invariants: ${d.node.invariants.join(", ")}` : null,
    ].filter(Boolean).join("\n") || "No vocabulary attached.";
  }
  return `Co-occurrence count: ${d.link.count}`;
}

function MemoryGraph({
  graph, layer, onDetail,
}: {
  graph: GraphData;
  layer: "short" | "long";
  onDetail: (d: DetailItem | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dims, setDims] = useState({ width: 300, height: 200 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.d3Force("link")?.distance(layer === "short" ? 80 : 120);
    graphRef.current.d3Force("charge")?.strength(layer === "short" ? -150 : -200);
  }, [graph, layer]);

  // Zoom to fit on initial load
  useEffect(() => {
    if (graphRef.current && graph.nodes.length > 0) {
      setTimeout(() => graphRef.current?.zoomToFit(300, 30), 200);
    }
  }, [graph.nodes.length > 0]);

  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const nodeColor = layer === "short"
    ? (dark ? "#f0a050" : "#d97706")
    : (dark ? "#8ab4f8" : "#1a73e8");
  const linkColor = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const textColor = dark ? "#ffffff" : "#111111";
  const labelBg = dark ? "rgba(30,30,30,0.85)" : "rgba(255,255,255,0.85)";

  const lastClickTime = useRef(0);
  const lastClickNode = useRef<string | null>(null);

  const handleNodeClick = (node: any) => {
    const now = Date.now();
    const isDouble = now - lastClickTime.current < 400 && lastClickNode.current === node.id;
    lastClickTime.current = now;
    lastClickNode.current = node.id;

    if (isDouble && graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 400);
      graphRef.current.zoom(3, 400);
    } else {
      onDetail({ kind: "node", node: node as GraphNode, layer });
    }
  };

  const handleLinkClick = (link: any) => {
    const src = typeof link.source === "object" ? link.source.id : link.source;
    const tgt = typeof link.target === "object" ? link.target.id : link.target;
    onDetail({ kind: "edge", link: { source: src, target: tgt, count: link.count }, layer });
  };

  return (
    <div ref={containerRef} className={styles.graphInner}>
      <ForceGraph2D
        ref={graphRef}
        graphData={graph}
        width={dims.width}
        height={dims.height}
        nodeLabel=""
        nodeColor={() => nodeColor}
        nodeRelSize={6}
        linkColor={() => linkColor}
        linkWidth={1.5}
        linkDirectionalArrowLength={0}
        linkCurvature={0.2}
        onNodeClick={handleNodeClick}
        onLinkClick={handleLinkClick}
        onBackgroundClick={() => onDetail(null)}
        onBackgroundRightClick={() => graphRef.current?.zoomToFit(400, 30)}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const label = node.name;
          const fontSize = 12 / globalScale;
          const baseRadius = 5 / globalScale;
          const radius = baseRadius * Math.sqrt(node.weight);

          ctx.fillStyle = nodeColor;
          ctx.globalAlpha = Math.max(0.4, Math.min(1, node.weight));
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
          ctx.fill();
          ctx.globalAlpha = 1;

          ctx.font = `bold ${fontSize}px sans-serif`;
          const metrics = ctx.measureText(label);
          const labelY = node.y! + radius + 3 / globalScale;
          const padX = 2 / globalScale;
          const padY = 1 / globalScale;

          ctx.fillStyle = labelBg;
          ctx.fillRect(
            node.x! - metrics.width / 2 - padX,
            labelY - padY,
            metrics.width + padX * 2,
            fontSize + padY * 2,
          );

          ctx.fillStyle = textColor;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(label, node.x!, labelY);
        }}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, 10 / globalScale, 0, 2 * Math.PI);
          ctx.fill();
        }}
        cooldownTicks={100}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}

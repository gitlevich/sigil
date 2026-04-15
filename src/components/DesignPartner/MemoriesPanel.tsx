/**
 * MemoriesPanel — visualizes the BicameralMind's remembered sigils.
 *
 * Reads from the live MemoryState via ExperienceContext.
 * Shows remembered sigils as a force-directed graph: nodes are remembered
 * sigils, edges are co-occurrence relationships from their stored positions.
 */
import { useState, useEffect, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useExperience } from "../../state/ExperienceContext";
import { allRemembered } from "sigil-core/memory";
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
  | { kind: "node"; node: GraphNode }
  | { kind: "edge"; link: GraphLink };

export function MemoriesPanel() {
  const { getMemory } = useExperience();
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 300, height: 400 });

  // Poll the live memory state
  useEffect(() => {
    const update = () => {
      const mem = getMemory();
      const remembered = allRemembered(mem);
      const rememberedNames = new Set(remembered.map(r => r.name));

      const nodes: GraphNode[] = remembered.map(r => ({
        id: r.name,
        name: r.name,
        weight: r.weight,
        affordances: r.vocabulary.affordances,
        invariants: r.vocabulary.invariants,
      }));

      // Build edges from stored co-occurrence positions, only between remembered sigils
      const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
      const edgeMap = new Map<string, { source: string; target: string; count: number }>();

      for (const r of remembered) {
        for (const e of r.edges) {
          if (!rememberedNames.has(e.target)) continue;
          const key = edgeKey(r.name, e.target);
          if (!edgeMap.has(key)) {
            edgeMap.set(key, { source: r.name, target: e.target, count: e.count });
          }
        }
      }

      setGraph({ nodes, links: [...edgeMap.values()] });
    };

    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [getMemory]);

  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.d3Force("link")?.distance(120);
      graphRef.current.d3Force("charge")?.strength(-200);
    }
  }, [graph]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const nodeColor = dark ? "#8ab4f8" : "#1a73e8";
  const linkColor = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
  const textColor = dark ? "#ffffff" : "#111111";
  const labelBg = dark ? "rgba(30,30,30,0.85)" : "rgba(255,255,255,0.85)";

  const detailHeight = detail ? 140 : 0;

  const lastClickTime = useRef(0);
  const lastClickNode = useRef<string | null>(null);

  const handleNodeClick = (node: any) => {
    const now = Date.now();
    const isDoubleClick =
      now - lastClickTime.current < 400 &&
      lastClickNode.current === node.id;

    lastClickTime.current = now;
    lastClickNode.current = node.id;

    if (isDoubleClick && graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 400);
      graphRef.current.zoom(3, 400);
    } else {
      setDetail({ kind: "node", node: node as GraphNode });
    }
  };

  const handleLinkClick = (link: any) => {
    const src = typeof link.source === "object" ? link.source.id : link.source;
    const tgt = typeof link.target === "object" ? link.target.id : link.target;
    setDetail({
      kind: "edge",
      link: { source: src, target: tgt, count: link.count },
    });
  };

  const detailTitle = detail
    ? detail.kind === "node"
      ? `${detail.node.name} (${detail.node.weight.toFixed(2)})`
      : `${detail.link.source} \u2194 ${detail.link.target}`
    : "";

  const detailBody = detail
    ? detail.kind === "node"
      ? [
          detail.node.affordances.length > 0 ? `Affordances: ${detail.node.affordances.join(", ")}` : null,
          detail.node.invariants.length > 0 ? `Invariants: ${detail.node.invariants.join(", ")}` : null,
        ].filter(Boolean).join("\n") || "No vocabulary attached."
      : `Co-occurrence count: ${detail.link.count}`
    : "";

  return (
    <div className={styles.container} ref={containerRef}>
      {graph.nodes.length === 0 ? (
        <div className={styles.empty}>
          No memories yet. Edit sigils to build remembered positions.
        </div>
      ) : (
        <ForceGraph2D
          ref={graphRef}
          graphData={graph}
          width={dimensions.width}
          height={dimensions.height - detailHeight}
          nodeLabel=""
          nodeColor={() => nodeColor}
          nodeRelSize={6}
          linkColor={() => linkColor}
          linkWidth={1.5}
          linkDirectionalArrowLength={0}
          linkCurvature={0.2}
          onNodeClick={handleNodeClick}
          onLinkClick={handleLinkClick}
          onBackgroundClick={() => setDetail(null)}
          onBackgroundRightClick={() => {
            if (graphRef.current) {
              graphRef.current.zoomToFit(400, 40);
            }
          }}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.name;
            const fontSize = 13 / globalScale;
            // Scale node radius by weight
            const baseRadius = 6 / globalScale;
            const radius = baseRadius * Math.sqrt(node.weight);

            ctx.fillStyle = nodeColor;
            ctx.globalAlpha = Math.max(0.3, Math.min(1, node.weight));
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.globalAlpha = 1;

            ctx.font = `bold ${fontSize}px sans-serif`;
            const metrics = ctx.measureText(label);
            const labelY = node.y! + radius + 4 / globalScale;
            const padX = 3 / globalScale;
            const padY = 2 / globalScale;

            ctx.fillStyle = labelBg;
            ctx.fillRect(
              node.x! - metrics.width / 2 - padX,
              labelY - padY,
              metrics.width + padX * 2,
              fontSize + padY * 2
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
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
        />
      )}
      {detail && (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <strong>{detailTitle}</strong>
            <button className={styles.closeBtn} onClick={() => setDetail(null)}>
              &times;
            </button>
          </div>
          <div className={styles.detailBody}>{detailBody}</div>
        </div>
      )}
    </div>
  );
}

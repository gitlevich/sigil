import { useState, useEffect, useRef, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useWorkspaceState } from "../../state/WorkspaceContext";
import { api, MemoryGraph } from "../../tauri";
import styles from "./MemoriesPanel.module.css";

interface GraphNode {
  id: string;
  name: string;
  language: string;
}

interface GraphLink {
  source: string;
  target: string;
  label: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

type DetailItem =
  | { kind: "node"; node: GraphNode }
  | { kind: "edge"; link: GraphLink };

export function MemoriesPanel() {
  const ws = useWorkspaceState();
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 300, height: 400 });

  const loadGraph = useCallback(async () => {
    try {
      const data: MemoryGraph = await api.readMemories(ws.spec.rootPath);
      setGraph({
        nodes: data.nodes.map((n) => ({ ...n })),
        links: data.edges.map((e) => ({ source: e.source, target: e.target, label: e.label })),
      });
    } catch (e) {
      console.error("Failed to load memories:", e);
    }
  }, [ws.spec.rootPath]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

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
      link: { source: src, target: tgt, label: link.label },
    });
  };

  const detailTitle = detail
    ? detail.kind === "node"
      ? detail.node.name
      : `${detail.link.source} \u2192 ${detail.link.target}`
    : "";

  const detailBody = detail
    ? detail.kind === "node"
      ? detail.node.language
      : detail.link.label
    : "";

  return (
    <div className={styles.container} ref={containerRef}>
      {graph.nodes.length === 0 ? (
        <div className={styles.empty}>
          No memories yet. Start a conversation to build knowledge.
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
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
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
            const radius = 6 / globalScale;

            ctx.fillStyle = nodeColor;
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
            ctx.fill();

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

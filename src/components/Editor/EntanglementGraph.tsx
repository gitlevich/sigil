import { useState, useRef, useCallback, useEffect } from "react";
import { useDocument, useAppDispatch } from "../../state/AppContext";
import { api, Context } from "../../tauri";
import { useSigil } from "../../hooks/useSigil";
import styles from "./EntanglementGraph.module.css";

export type Policy =
  | "shared-kernel"
  | "published-language"
  | "customer-supplier"
  | "conformist"
  | "anticorruption-layer"
  | "separate-ways";

export interface Entanglement {
  from: string; // context name (upstream / source)
  to: string;   // context name (downstream / target)
  policy: Policy;
}

export interface EntanglementData {
  entanglements: Entanglement[];
}

const POLICY_LABELS: Record<Policy, string> = {
  "shared-kernel": "Shared Kernel",
  "published-language": "Published Language",
  "customer-supplier": "Customer-Supplier",
  "conformist": "Conformist",
  "anticorruption-layer": "Anticorruption Layer",
  "separate-ways": "Separate Ways",
};

const SYMMETRIC_POLICIES: Policy[] = ["shared-kernel", "published-language", "separate-ways"];

interface NodePos {
  name: string;
  x: number;
  y: number;
}

function findContext(root: Context, path: string[]): Context {
  let current = root;
  for (const seg of path) {
    const child = current.children.find((c) => c.name === seg);
    if (!child) return current;
    current = child;
  }
  return current;
}

export function EntanglementGraph() {
  const doc = useDocument();
  const dispatch = useAppDispatch();
  const svgRef = useRef<SVGSVGElement>(null);
  const [entanglements, setEntanglements] = useState<Entanglement[]>([]);
  const [dragging, setDragging] = useState<{ from: string; mx: number; my: number } | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; name: string; path: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const { reload } = useSigil();

  const currentCtx = doc ? findContext(doc.sigil.root, doc.currentPath) : null;
  const children = currentCtx?.children ?? [];

  // Load entanglements from disk
  useEffect(() => {
    if (!currentCtx) return;
    const path = `${currentCtx.path}/entanglements.json`;
    api.readFile(path)
      .then((content) => {
        const data: EntanglementData = JSON.parse(content);
        setEntanglements(data.entanglements || []);
      })
      .catch(() => setEntanglements([]));
  }, [currentCtx?.path]);

  // Measure container
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleClick = () => setNodeMenu(null);
    if (nodeMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [nodeMenu]);

  const saveEntanglements = useCallback(async (data: Entanglement[]) => {
    if (!currentCtx) return;
    const path = `${currentCtx.path}/entanglements.json`;
    const content = JSON.stringify({ entanglements: data }, null, 2);
    await api.writeFile(path, content);
  }, [currentCtx]);

  // Lay out nodes in a circle
  const nodePositions: NodePos[] = children.map((child, i) => {
    const angle = (2 * Math.PI * i) / children.length - Math.PI / 2;
    const rx = dimensions.width * 0.35;
    const ry = dimensions.height * 0.35;
    return {
      name: child.name,
      x: dimensions.width / 2 + rx * Math.cos(angle),
      y: dimensions.height / 2 + ry * Math.sin(angle),
    };
  });

  const getPos = (name: string) => nodePositions.find((n) => n.name === name);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setDragging({
      ...dragging,
      mx: e.clientX - rect.left,
      my: e.clientY - rect.top,
    });
  }, [dragging]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Find which node we dropped on
    const target = nodePositions.find((n) => {
      const dx = n.x - mx;
      const dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) < 30;
    });

    if (target && target.name !== dragging.from) {
      // Check if edge already exists (in either direction)
      const exists = entanglements.some(
        (e) =>
          (e.from === dragging.from && e.to === target.name) ||
          (e.from === target.name && e.to === dragging.from)
      );
      if (!exists) {
        // Create edge with default policy and immediately open policy picker
        const newEdge: Entanglement = { from: dragging.from, to: target.name, policy: "customer-supplier" };
        const newEntanglements = [...entanglements, newEdge];
        setEntanglements(newEntanglements);
        saveEntanglements(newEntanglements);
        setSelectedEdge({ from: dragging.from, to: target.name });
      }
    }

    setDragging(null);
  }, [dragging, nodePositions, entanglements, saveEntanglements]);

  const handlePolicyChange = (from: string, to: string, policy: Policy) => {
    const updated = entanglements.map((e) =>
      e.from === from && e.to === to ? { ...e, policy } : e
    );
    setEntanglements(updated);
    saveEntanglements(updated);
    setSelectedEdge(null);
  };

  const handleDeleteEdge = (from: string, to: string) => {
    const updated = entanglements.filter((e) => !(e.from === from && e.to === to));
    setEntanglements(updated);
    saveEntanglements(updated);
    setSelectedEdge(null);
  };

  const handleNodeDoubleClick = (name: string) => {
    if (!doc) return;
    dispatch({
      type: "UPDATE_DOCUMENT",
      updates: { currentPath: [...doc.currentPath, name], showTechnical: false },
    });
  };

  if (!doc || children.length === 0) {
    return (
      <div className={styles.empty}>
        No sub-contexts to show. Add contexts to see entanglements.
      </div>
    );
  }

  const NODE_R = 28;

  return (
    <div className={styles.container}>
      <svg
        ref={svgRef}
        className={styles.svg}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={() => { setSelectedEdge(null); setSelectedNode(null); }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="var(--accent)" />
          </marker>
        </defs>

        {/* Edges */}
        {entanglements.map((ent) => {
          const fromPos = getPos(ent.from);
          const toPos = getPos(ent.to);
          if (!fromPos || !toPos) return null;

          const isSymmetric = SYMMETRIC_POLICIES.includes(ent.policy);
          const isSelected = selectedEdge?.from === ent.from && selectedEdge?.to === ent.to;

          // Shorten line to stop at node edge
          const dx = toPos.x - fromPos.x;
          const dy = toPos.y - fromPos.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ux = dx / len;
          const uy = dy / len;
          const x1 = fromPos.x + ux * NODE_R;
          const y1 = fromPos.y + uy * NODE_R;
          const x2 = toPos.x - ux * (NODE_R + (isSymmetric ? 0 : 8));
          const y2 = toPos.y - uy * (NODE_R + (isSymmetric ? 0 : 8));

          const midX = (fromPos.x + toPos.x) / 2;
          const midY = (fromPos.y + toPos.y) / 2;

          return (
            <g key={`${ent.from}-${ent.to}`}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isSelected ? "var(--accent)" : "var(--text-secondary)"}
                strokeWidth={isSelected ? 3 : 2}
                markerEnd={isSymmetric ? undefined : "url(#arrowhead)"}
                style={{ cursor: "pointer" }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEdge({ from: ent.from, to: ent.to });
                }}
              />
              <text
                x={midX}
                y={midY - 8}
                textAnchor="middle"
                fill="var(--text-secondary)"
                fontSize="10"
                style={{ pointerEvents: "none" }}
              >
                {POLICY_LABELS[ent.policy]}
              </text>
            </g>
          );
        })}

        {/* Drag line */}
        {dragging && (() => {
          const fromPos = getPos(dragging.from);
          if (!fromPos) return null;
          return (
            <line
              x1={fromPos.x} y1={fromPos.y}
              x2={dragging.mx} y2={dragging.my}
              stroke="var(--accent)"
              strokeWidth="2"
              strokeDasharray="6 3"
              markerEnd="url(#arrowhead)"
              style={{ pointerEvents: "none" }}
            />
          );
        })()}

        {/* Nodes */}
        {nodePositions.map((node) => (
          <g
            key={node.name}
            style={{ cursor: "grab" }}
            onMouseDown={(e) => {
              if (e.button !== 2) {
                e.preventDefault();
                const rect = svgRef.current!.getBoundingClientRect();
                setDragging({
                  from: node.name,
                  mx: e.clientX - rect.left,
                  my: e.clientY - rect.top,
                });
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedNode(node.name);
              // Navigate tree to this child so it highlights there
              if (doc) {
                dispatch({
                  type: "UPDATE_DOCUMENT",
                  updates: { currentPath: [...doc.currentPath, node.name] },
                });
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const child = children.find((c) => c.name === node.name);
              if (child) {
                setNodeMenu({ x: e.clientX, y: e.clientY, name: node.name, path: child.path });
              }
            }}
            onDoubleClick={() => handleNodeDoubleClick(node.name)}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={NODE_R}
              fill={selectedNode === node.name ? "var(--accent)" : "var(--bg-secondary)"}
              stroke="var(--accent)"
              strokeWidth="2"
            />
            <text
              x={node.x}
              y={node.y + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={selectedNode === node.name ? "var(--accent-text)" : "var(--text-primary)"}
              fontSize="11"
              fontWeight="500"
              style={{ pointerEvents: "none" }}
            >
              {node.name.length > 8 ? node.name.slice(0, 7) + "\u2026" : node.name}
            </text>
          </g>
        ))}
      </svg>

      {/* Policy editor popover */}
      {selectedEdge && (() => {
        const ent = entanglements.find(
          (e) => e.from === selectedEdge.from && e.to === selectedEdge.to
        );
        if (!ent) return null;
        const fromPos = getPos(ent.from);
        const toPos = getPos(ent.to);
        if (!fromPos || !toPos) return null;

        return (
          <div
            className={styles.policyPopover}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.policyHeader}>
              {ent.from} &rarr; {ent.to}
            </div>
            <div className={styles.policyList}>
              {(Object.keys(POLICY_LABELS) as Policy[]).map((p) => (
                <button
                  key={p}
                  className={`${styles.policyOption} ${ent.policy === p ? styles.policyActive : ""}`}
                  onClick={() => handlePolicyChange(ent.from, ent.to, p)}
                >
                  {POLICY_LABELS[p]}
                </button>
              ))}
            </div>
            <button
              className={styles.deleteEdgeBtn}
              onClick={() => handleDeleteEdge(ent.from, ent.to)}
            >
              Remove
            </button>
          </div>
        );
      })()}

      {nodeMenu && (
        <div
          className={styles.policyPopover}
          style={{ left: nodeMenu.x, top: nodeMenu.y, transform: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.policyHeader}>{nodeMenu.name}</div>
          <div className={styles.policyList}>
            <button
              className={styles.policyOption}
              onClick={() => {
                const name = prompt("Rename:", nodeMenu.name);
                if (!name?.trim()) { setNodeMenu(null); return; }
                api.renameContext(nodeMenu.path, name.trim())
                  .then(() => doc && reload(doc.sigil.root_path))
                  .catch(console.error);
                setNodeMenu(null);
              }}
            >
              Rename
            </button>
            <button
              className={styles.policyOption}
              onClick={() => {
                api.revealInFinder(nodeMenu.path).catch(console.error);
                setNodeMenu(null);
              }}
            >
              Open in Finder
            </button>
            <button
              className={styles.deleteEdgeBtn}
              onClick={() => {
                if (!confirm(`Delete "${nodeMenu.name}" and all its contents?`)) { setNodeMenu(null); return; }
                api.deleteContext(nodeMenu.path)
                  .then(() => doc && reload(doc.sigil.root_path))
                  .catch(console.error);
                setNodeMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <div className={styles.instructions}>
        Drag between sigils to entangle. Click an edge to change policy. Double-click a sigil to enter it.
      </div>
    </div>
  );
}

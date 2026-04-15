/**
 * SigilSpace3D — 3D viewer for the sigil hierarchy.
 *
 * Renders sigils as nested translucent spheres in a Three.js scene.
 * Double-click a sigil to enter it: camera flies inside, showing
 * children as objects, parent shell as sky, neighbors as doors.
 * Click the background to go up one level.
 */
import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Text, Line } from "@react-three/drei";
import * as THREE from "three";
import { useWorkspaceState, useWorkspaceActions } from "../../state/WorkspaceContext";
import { buildSigilSpace } from "sigil-core";
import {
  buildLayout,
  type SphereNode,
} from "./sigilSpaceLayout";

// ── Helpers ──

function findNode(root: SphereNode, path: string[]): SphereNode | null {
  const key = path.join("/");
  if (root.path.join("/") === key) return root;
  for (const child of root.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

// ── Camera controller ──
// Single-finger drag: pan in screen plane
// Two-finger swipe (wheel without ctrlKey): horizontal = rotate horizontally, vertical = rotate vertically
// Shift + single-finger drag vertical: dolly (closer/further along z)
// Pinch (wheel with ctrlKey): also dolly
// Double-click sigil: snap camera to its center

interface CameraHandlerProps {
  target: [number, number, number];
  distance: number;
}

function CameraHandler({ target, distance }: CameraHandlerProps) {
  const { camera, gl } = useThree();
  const pivotRef = useRef(new THREE.Vector3(...target));
  const prevTargetKey = useRef("");

  // Snap to new sigil when inhabited path changes
  useEffect(() => {
    const key = target.join(",");
    if (key === prevTargetKey.current) return;
    prevTargetKey.current = key;

    pivotRef.current.set(...target);
    const dir = camera.position.clone().sub(pivotRef.current).normalize();
    if (dir.lengthSq() < 0.001) dir.set(0, 0.3, 1).normalize();
    camera.position.copy(pivotRef.current).add(dir.multiplyScalar(distance));
    camera.lookAt(pivotRef.current);
  }, [target, distance, camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    let dragging = false;
    let shiftDrag = false;
    let lastX = 0;
    let lastY = 0;

    // ── Pointer: single-finger drag = pan, shift+drag = dolly ──

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      shiftDrag = e.shiftKey;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (shiftDrag || e.shiftKey) {
        // Shift+drag vertical = move along world Z axis
        const zOffset = new THREE.Vector3(0, 0, dy * 0.01);
        camera.position.add(zOffset);
        pivotRef.current.add(zOffset);
      } else {
        // Plain drag = pan in screen plane
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        right.setFromMatrixColumn(camera.matrix, 0);
        up.setFromMatrixColumn(camera.matrix, 1);
        const scale = 0.004;
        const offset = right.multiplyScalar(-dx * scale).add(up.multiplyScalar(dy * scale));
        camera.position.add(offset);
        pivotRef.current.add(offset);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      shiftDrag = false;
      canvas.releasePointerCapture(e.pointerId);
    };

    // ── Wheel: two-finger swipe = rotate, pinch (ctrlKey) = dolly ──

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey) {
        // Pinch = dolly
        const dir = camera.position.clone().sub(pivotRef.current);
        const factor = 1 + e.deltaY * 0.005;
        dir.multiplyScalar(factor);
        camera.position.copy(pivotRef.current).add(dir);
      } else {
        // Two-finger swipe = orbit around pivot
        const spherical = new THREE.Spherical();
        const offset = camera.position.clone().sub(pivotRef.current);
        spherical.setFromVector3(offset);

        // Horizontal swipe = rotate azimuth
        spherical.theta -= e.deltaX * 0.003;
        // Vertical swipe = rotate polar
        spherical.phi -= e.deltaY * 0.003;
        // Clamp polar to avoid flipping
        spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));

        offset.setFromSpherical(spherical);
        camera.position.copy(pivotRef.current).add(offset);
        camera.lookAt(pivotRef.current);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl]);

  return null;
}

// ── Info panel — fixed overlay, shows details of hovered/pinned sigil ──

interface InfoPanelProps {
  node: SphereNode | null;
  pinned: SphereNode | null;
  dark: boolean;
  onDismiss: () => void;
}

function InfoPanel({ node, pinned, dark, onDismiss }: InfoPanelProps) {
  const display = pinned ?? node;
  if (!display) return null;

  const bg = dark ? "rgba(12,12,30,0.94)" : "rgba(255,255,255,0.96)";
  const fg = dark ? "#d0d0e0" : "#2a2a3a";
  const dimFg = dark ? "#8888aa" : "#6a6a8a";
  const accentFg = dark ? "#88aadd" : "#4466aa";
  const invariantFg = dark ? "#cc8888" : "#aa4444";

  return (
    <div
      onClick={pinned ? onDismiss : undefined}
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        background: bg,
        color: fg,
        padding: "14px 18px",
        borderRadius: 10,
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.6,
        border: `1px solid ${dark ? "rgba(100,100,160,0.25)" : "rgba(0,0,0,0.08)"}`,
        maxWidth: 360,
        maxHeight: "50%",
        overflow: "auto",
        boxShadow: dark
          ? "0 6px 30px rgba(0,0,0,0.6)"
          : "0 6px 30px rgba(0,0,0,0.1)",
        cursor: pinned ? "pointer" : "default",
        pointerEvents: "auto",
        zIndex: 10,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
        {display.name}
        {pinned && <span style={{ color: dimFg, fontSize: 11, marginLeft: 8, fontWeight: 400 }}>click to dismiss</span>}
      </div>

      {/* Affordances — the surface */}
      {display.affordanceNames.length > 0 && (
        <div style={{ color: accentFg, fontSize: 12, marginBottom: 4 }}>
          {display.affordanceNames.map(a => `#${a}`).join("  ")}
        </div>
      )}

      {/* Invariants — the shell */}
      {display.invariantNames.length > 0 && (
        <div style={{ color: invariantFg, fontSize: 12, marginBottom: 4 }}>
          {display.invariantNames.map(i => `!${i}`).join("  ")}
        </div>
      )}

      {/* Language — the narrative inside */}
      {display.language && (
        <div style={{
          color: dimFg,
          fontSize: 12,
          marginTop: 8,
          paddingTop: 8,
          borderTop: `1px solid ${dark ? "rgba(100,100,160,0.15)" : "rgba(0,0,0,0.06)"}`,
          whiteSpace: "pre-wrap",
        }}>
          {display.language}
        </div>
      )}

      {display.children.length > 0 && (
        <div style={{ color: dimFg, fontSize: 11, marginTop: 8 }}>
          {display.children.length} child{display.children.length !== 1 ? "ren" : ""}
          {" \u2014 double-click to enter"}
        </div>
      )}

      {display.entanglements.length > 0 && (
        <div style={{ color: dimFg, fontSize: 11, marginTop: 4 }}>
          entangled with: {display.entanglements.slice(0, 5).map(e => e.target).join(", ")}
          {display.entanglements.length > 5 && ` +${display.entanglements.length - 5} more`}
        </div>
      )}
    </div>
  );
}

// ── Sphere mesh for a single sigil ──

interface SigilSphereProps {
  node: SphereNode;
  isInhabited: boolean;
  isChild: boolean;
  dark: boolean;
  onEnter: (path: string[]) => void;
  onHover: (node: SphereNode | null) => void;
  onSelect: (node: SphereNode) => void;
}

function SigilSphere({ node, isInhabited, isChild, dark, onEnter, onHover, onSelect }: SigilSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Children of inhabited sigil are more opaque and vivid
  const baseOpacity = isChild ? 0.25 : isInhabited ? 0.06 : Math.min(0.10 + node.depth * 0.04, 0.35);
  const opacity = baseOpacity;

  // Color: hue shifts by depth, saturation by invariant count
  const hue = (node.depth * 0.15 + 0.55) % 1;
  const saturation = isChild
    ? Math.min(0.4 + node.invariantNames.length * 0.1, 0.9)
    : Math.min(0.2 + node.invariantNames.length * 0.06, 0.6);
  const lightness = dark ? 0.55 : 0.45;
  const color = useMemo(() => new THREE.Color().setHSL(hue, saturation, lightness), [hue, saturation, lightness]);
  const highlightColor = useMemo(() => new THREE.Color().setHSL(hue, saturation, dark ? 0.75 : 0.65), [hue, saturation, dark]);

  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(node);
  }, [node, onSelect]);

  const handleDoubleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onEnter(node.path);
  }, [node.path, onEnter]);

  // Subtle breathing for children of inhabited sigil
  useFrame(() => {
    if (!meshRef.current) return;
    if (isChild) {
      const scale = 1 + Math.sin(Date.now() * 0.003) * 0.008;
      meshRef.current.scale.setScalar(scale);
    } else {
      meshRef.current.scale.setScalar(1);
    }
  });

  return (
    <group position={node.position}>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          onHover(node);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          onHover(null);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[node.radius, 32, 32]} />
        <meshPhysicalMaterial
          color={hovered ? highlightColor : color}
          transparent
          opacity={hovered ? Math.min(opacity + 0.12, 0.7) : opacity}
          roughness={0.1}
          metalness={0.0}
          clearcoat={isChild ? 0.5 : 0.2}
          clearcoatRoughness={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Wireframe shell — invariant boundary, more visible for children */}
      <mesh>
        <sphereGeometry args={[node.radius * 1.001, isChild ? 24 : 12, isChild ? 24 : 12]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={isChild
            ? Math.min(0.1 + node.invariantNames.length * 0.05, 0.35)
            : Math.min(0.05 + node.invariantNames.length * 0.02, 0.15)}
          depthWrite={false}
        />
      </mesh>

      {/* Label */}
      <Text
        position={[0, node.radius + node.radius * 0.12, 0]}
        fontSize={isChild ? node.radius * 0.3 : node.radius * 0.2}
        color={dark ? "#c8c8d0" : "#3a3a4a"}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={node.radius * 0.012}
        outlineColor={dark ? "#0a0a14" : "#ffffff"}
        fontWeight={isChild ? 700 : 400}
      >
        {node.name}
      </Text>
    </group>
  );
}

// ── Entanglement lines — only between visible nodes ──

interface EntanglementLinesProps {
  nodes: SphereNode[];
  dark: boolean;
}

function EntanglementLines({ nodes, dark }: EntanglementLinesProps) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, SphereNode>();
    for (const n of nodes) m.set(n.name, n);
    return m;
  }, [nodes]);

  const lines = useMemo(() => {
    const seen = new Set<string>();
    const result: { from: [number, number, number]; to: [number, number, number]; strength: number }[] = [];
    for (const node of nodes) {
      for (const ent of node.entanglements) {
        const key = [node.name, ent.target].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const target = nodeMap.get(ent.target);
        if (target) {
          result.push({ from: node.position, to: target.position, strength: ent.strength });
        }
      }
    }
    return result;
  }, [nodes, nodeMap]);

  const maxStrength = useMemo(
    () => Math.max(1, ...lines.map(l => l.strength)),
    [lines],
  );

  return (
    <>
      {lines.map((line, i) => {
        const alpha = 0.08 + (line.strength / maxStrength) * 0.3;
        return (
          <Line
            key={i}
            points={[line.from, line.to]}
            color={dark ? "#6688cc" : "#4466aa"}
            lineWidth={0.5 + (line.strength / maxStrength) * 1.5}
            transparent
            opacity={alpha}
          />
        );
      })}
    </>
  );
}

// ── Scene ──

interface SceneProps {
  root: SphereNode;
  inhabitedPath: string[];
  dark: boolean;
  onNavigate: (path: string[]) => void;
  onHover: (node: SphereNode | null) => void;
  onSelect: (node: SphereNode) => void;
}

function Scene({ root, inhabitedPath, dark, onNavigate, onHover, onSelect }: SceneProps) {
  // Find the currently inhabited sigil
  const inhabited = useMemo(
    () => findNode(root, inhabitedPath) ?? root,
    [root, inhabitedPath],
  );

  const visibleNodes = useMemo(() => {
    const nodes: SphereNode[] = [];
    nodes.push(inhabited);
    for (const child of inhabited.children) {
      nodes.push(child);
      for (const grandchild of child.children) {
        nodes.push(grandchild);
      }
    }
    return nodes;
  }, [inhabited]);

  const cameraDistance = inhabited.radius * 1.8;

  const handleBackgroundClick = useCallback(() => {
    if (inhabitedPath.length > 0) {
      onNavigate(inhabitedPath.slice(0, -1));
    }
  }, [inhabitedPath, onNavigate]);

  const inhabitedKey = inhabitedPath.join("/");

  return (
    <>
      <ambientLight intensity={dark ? 0.5 : 0.65} />
      <directionalLight position={[5, 8, 5]} intensity={dark ? 0.5 : 0.7} />
      <directionalLight position={[-3, -3, -5]} intensity={0.15} />

      <mesh position={[0, 0, -50]} onDoubleClick={handleBackgroundClick}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {visibleNodes.map((node) => {
        const nodeKey = node.path.join("/");
        const isInhabited = nodeKey === inhabitedKey;
        const isChild = node.path.length === inhabitedPath.length + 1
          && nodeKey.startsWith(inhabitedKey);
        return (
          <SigilSphere
            key={nodeKey || "__root__"}
            node={node}
            isInhabited={isInhabited}
            isChild={isChild}
            dark={dark}
            onEnter={onNavigate}
            onHover={onHover}
            onSelect={onSelect}
          />
        );
      })}

      <EntanglementLines nodes={visibleNodes} dark={dark} />

      <CameraHandler
        target={inhabited.position}
        distance={cameraDistance}
      />
    </>
  );
}

// ── Main component ──

export function SigilSpace3D() {
  const ws = useWorkspaceState();
  const { navigate } = useWorkspaceActions();

  const dark = document.documentElement.getAttribute("data-theme") === "dark";

  const layout = useMemo(() => {
    const space = buildSigilSpace(ws.spec.root, ws.spec.importedOntologies ?? null);
    return buildLayout(ws.spec.root, space);
  }, [ws.spec.root, ws.spec.importedOntologies]);

  const [hoveredNode, setHoveredNode] = useState<SphereNode | null>(null);
  const [pinnedNode, setPinnedNode] = useState<SphereNode | null>(null);
  const [infoPanelVisible, setInfoPanelVisible] = useState(true);

  const handleNavigate = useCallback((path: string[]) => {
    setPinnedNode(null);
    navigate(path);
  }, [navigate]);

  // Cmd+I toggles info panel (via menu event or keyboard)
  useEffect(() => {
    const toggle = () => setInfoPanelVisible(v => !v);
    window.addEventListener("sigil-toggle-info-panel", toggle);
    return () => window.removeEventListener("sigil-toggle-info-panel", toggle);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: dark ? "#0a0a14" : "#f0f0f8" }}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 39, near: 0.001, far: 200 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={[dark ? "#0a0a14" : "#f0f0f8"]} />
        <Scene
          root={layout}
          inhabitedPath={ws.currentPath}
          dark={dark}
          onNavigate={handleNavigate}
          onHover={setHoveredNode}
          onSelect={setPinnedNode}
        />
      </Canvas>
      {infoPanelVisible && (
        <InfoPanel
          node={hoveredNode}
          pinned={pinnedNode}
          dark={dark}
          onDismiss={() => setPinnedNode(null)}
        />
      )}
    </div>
  );
}

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
import { Text } from "@react-three/drei";
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
  /** Used to detect when we've entered a new sigil, even if the position is the same. */
  inhabitedKey: string;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  pivotRef: React.MutableRefObject<THREE.Vector3 | null>;
}

/** Camera viewing direction — below-right, looking up (Hollywood sign). */
const CAMERA_DIR = new THREE.Vector3(0.3, -0.2, 1).normalize();

function CameraHandler({ target, distance, inhabitedKey, cameraRef, pivotRef: externalPivotRef }: CameraHandlerProps) {
  const { camera, gl } = useThree();
  const pivotRef = useRef(new THREE.Vector3(...target));
  const prevTargetKey = useRef("");

  // Animation state for smooth transitions
  const animRef = useRef<{
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startPivot: THREE.Vector3;
    endPivot: THREE.Vector3;
    startTime: number;
    duration: number;
  } | null>(null);

  // Expose camera and pivot to parent
  useEffect(() => {
    cameraRef.current = camera;
    externalPivotRef.current = pivotRef.current;
  }, [camera, cameraRef, externalPivotRef]);

  // Start animated transition when inhabited path changes
  useEffect(() => {
    if (inhabitedKey === prevTargetKey.current) return;
    const isFirst = prevTargetKey.current === "";
    prevTargetKey.current = inhabitedKey;

    const endPivot = new THREE.Vector3(...target);
    const endPos = endPivot.clone().add(CAMERA_DIR.clone().multiplyScalar(distance));

    if (isFirst) {
      // First mount — snap immediately, no animation
      pivotRef.current.copy(endPivot);
      externalPivotRef.current = pivotRef.current;
      camera.position.copy(endPos);
      camera.lookAt(pivotRef.current);
    } else {
      // Animate from current position
      animRef.current = {
        startPos: camera.position.clone(),
        endPos,
        startPivot: pivotRef.current.clone(),
        endPivot,
        startTime: performance.now(),
        duration: 550,
      };
    }
  }, [target, distance, camera]);

  // Drive the animation each frame
  useFrame(() => {
    const anim = animRef.current;
    if (!anim) return;

    const elapsed = performance.now() - anim.startTime;
    let t = Math.min(1, elapsed / anim.duration);
    // Ease-in-out cubic — slow start, fast middle, gentle landing
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(anim.startPos, anim.endPos, t);
    pivotRef.current.lerpVectors(anim.startPivot, anim.endPivot, t);
    externalPivotRef.current = pivotRef.current;
    camera.lookAt(pivotRef.current);

    if (t >= 1) animRef.current = null;
  });

  useEffect(() => {
    const canvas = gl.domElement;
    let pointerDown = false;
    let dragging = false;
    let shiftDrag = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let pointerId = -1;
    const DRAG_THRESHOLD = 4; // pixels before we consider it a drag

    // ── Pointer: single-finger drag = pan, shift+drag = Z-axis ──
    // Only capture after the pointer moves past threshold, so clicks reach R3F meshes.

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerDown = true;
      dragging = false;
      shiftDrag = e.shiftKey;
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      pointerId = e.pointerId;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointerDown) return;

      if (!dragging) {
        const dist = Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY);
        if (dist < DRAG_THRESHOLD) return;
        dragging = true;
        canvas.setPointerCapture(pointerId);
      }

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (shiftDrag || e.shiftKey) {
        const zOffset = new THREE.Vector3(0, 0, dy * 0.01);
        camera.position.add(zOffset);
        pivotRef.current.add(zOffset);
      } else {
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
      if (dragging) {
        canvas.releasePointerCapture(e.pointerId);
      }
      pointerDown = false;
      dragging = false;
      shiftDrag = false;
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

// ── Transition animator — flies camera into a sigil, dissolves its walls ──

interface TransitionAnimatorProps {
  transitionRef: React.RefObject<TransitionState | null>;
  cameraRef: React.RefObject<THREE.Camera | null>;
  pivotRef: React.RefObject<THREE.Vector3 | null>;
  onProgress: (t: number) => void;
  onComplete: (path: string[]) => void;
}

function TransitionAnimator({ transitionRef, cameraRef, pivotRef, onProgress, onComplete }: TransitionAnimatorProps) {
  useFrame(() => {
    const tr = transitionRef.current;
    if (!tr) return;
    const camera = cameraRef.current;
    const pivot = pivotRef.current;
    if (!camera || !pivot) return;

    const elapsed = performance.now() - tr.startTime;
    // Ease-in-out cubic
    let t = Math.min(1, elapsed / tr.duration);
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Lerp camera position toward the target center
    camera.position.lerpVectors(tr.startPos, tr.targetPos, t);
    // Lerp pivot
    pivot.lerpVectors(tr.startPivot, tr.targetPos, t);
    camera.lookAt(pivot);

    onProgress(t);

    if (elapsed >= tr.duration) {
      const path = tr.targetPath;
      transitionRef.current = null;
      onComplete(path);
    }
  });

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
  /** 0 = solid, 1 = fully dissolved. Used during fly-in transition. */
  dissolve?: number;
}

function SigilSphere({ node, isInhabited, isChild, dark, onEnter, onHover, onSelect, dissolve = 0 }: SigilSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Children of inhabited sigil are more opaque and vivid
  const baseOpacity = isChild ? 0.25 : isInhabited ? 0.06 : Math.min(0.10 + node.depth * 0.04, 0.35);
  // Dissolve: fade to zero as the camera flies through the wall
  const opacity = baseOpacity * (1 - dissolve);

  // Color: hue shifts by depth, saturation by invariant count
  const hue = (node.depth * 0.15 + 0.55) % 1;
  const saturation = isChild
    ? Math.min(0.4 + node.invariantNames.length * 0.1, 0.9)
    : Math.min(0.2 + node.invariantNames.length * 0.06, 0.6);
  const lightness = dark ? 0.55 : 0.45;
  const color = useMemo(() => new THREE.Color().setHSL(hue, saturation, lightness), [hue, saturation, lightness]);
  const highlightColor = useMemo(() => new THREE.Color().setHSL(hue, saturation, dark ? 0.75 : 0.65), [hue, saturation, dark]);

  const [hovered, setHovered] = useState(false);

  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Delay single-click so double-click can cancel it
    clickTimer.current = setTimeout(() => onSelect(node), 250);
  }, [node, onSelect]);

  const handleDoubleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    onEnter(node.path);
  }, [node.name, node.path, onEnter]);

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

  // Inhabited sphere: no raycasting, clicks pass through to children
  const noRaycast = useCallback(() => {}, []);

  return (
    <group position={node.position}>
      <mesh
        ref={meshRef}
        raycast={isInhabited ? noRaycast : undefined}
        onClick={isInhabited ? undefined : handleClick}
        onDoubleClick={isInhabited ? undefined : handleDoubleClick}
        onPointerOver={isInhabited ? undefined : (e) => {
          e.stopPropagation();
          setHovered(true);
          onHover(node);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={isInhabited ? undefined : () => {
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
          opacity={(isChild
            ? Math.min(0.1 + node.invariantNames.length * 0.05, 0.35)
            : Math.min(0.05 + node.invariantNames.length * 0.02, 0.15)) * (1 - dissolve)}
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
  onHoverLabel: (label: { text: string; x: number; y: number } | null) => void;
}

interface EntanglementEdge {
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromRadius: number;
  toRadius: number;
  fromName: string;
  toName: string;
  strength: number;
  labels: string[];
  sentences: string[];
}

/** A single pipe connector between two entangled sigils. */
function Pipe({ edge, dark, onHoverLabel }: { edge: EntanglementEdge; dark: boolean; onHoverLabel: (label: { text: string; x: number; y: number } | null) => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const dotRef = useRef<THREE.Mesh>(null);

  // Shorten pipe to end at sphere edges, not centers
  const dir = new THREE.Vector3().subVectors(edge.to, edge.from);
  const fullLength = dir.length();
  dir.normalize();
  const shortenedFrom = edge.from.clone().add(dir.clone().multiplyScalar(edge.fromRadius));
  const shortenedTo = edge.to.clone().add(dir.clone().multiplyScalar(-edge.toRadius));
  const pipeLength = Math.max(0, fullLength - edge.fromRadius - edge.toRadius);
  const pipeMid = new THREE.Vector3().addVectors(shortenedFrom, shortenedTo).multiplyScalar(0.5);

  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.position.copy(pipeMid);
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    meshRef.current.quaternion.copy(quat);
  }, [edge]);

  const pipeRadius = 0.002 + edge.strength * 0.0005;
  const alpha = 0.3 + Math.min(edge.strength * 0.06, 0.35);
  // Hover text: the sentences that connect these two sigils
  const hoverText = edge.sentences.length > 0
    ? edge.sentences.join(" \u2014 ")
    : `${edge.fromName} \u2014 ${edge.toName}`;

  if (pipeLength <= 0) return null;

  return (
    <group>
      <mesh ref={meshRef}>
        <cylinderGeometry args={[pipeRadius, pipeRadius, pipeLength, 6]} />
        <meshPhysicalMaterial
          color={dark ? "#446688" : "#4466aa"}
          transparent
          opacity={alpha}
          roughness={0.4}
          metalness={0.05}
        />
      </mesh>
      {/* Dot at midpoint — always visible, hover shows connection info */}
      <mesh
        ref={dotRef}
        position={pipeMid}
        onPointerOver={(e) => {
          e.stopPropagation();
          const evt = e.nativeEvent as MouseEvent;
          onHoverLabel({ text: hoverText, x: evt.clientX, y: evt.clientY });
          document.body.style.cursor = "help";
        }}
        onPointerMove={(e) => {
          const evt = e.nativeEvent as MouseEvent;
          onHoverLabel({ text: hoverText, x: evt.clientX, y: evt.clientY });
        }}
        onPointerOut={() => { onHoverLabel(null); document.body.style.cursor = "auto"; }}
      >
        <sphereGeometry args={[Math.max(pipeRadius * 3, 0.006), 8, 8]} />
        <meshBasicMaterial
          color={dark ? "#556688" : "#667799"}
          transparent
          opacity={0.6}
        />
      </mesh>
    </group>
  );
}

function EntanglementLines({ nodes, dark, onHoverLabel }: EntanglementLinesProps) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, SphereNode>();
    for (const n of nodes) m.set(n.name, n);
    return m;
  }, [nodes]);

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const result: EntanglementEdge[] = [];
    for (const node of nodes) {
      for (const ent of node.entanglements) {
        const key = [node.name, ent.target].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const target = nodeMap.get(ent.target);
        if (target) {
          const from = new THREE.Vector3(...node.position);
          const to = new THREE.Vector3(...target.position);
          // Merge labels from both directions
          const labels = new Set<string>();
          for (const a of ent.sharedAffordances) labels.add(a);
          const reverse = target.entanglements.find(e => e.target === node.name);
          if (reverse) {
            for (const a of reverse.sharedAffordances) labels.add(a);
          }
          result.push({
            from, to,
            fromRadius: node.radius,
            toRadius: target.radius,
            fromName: node.name,
            toName: target.name,
            strength: ent.strength,
            labels: [...labels],
            sentences: [...new Set([
              ...ent.sentences,
              ...(reverse?.sentences ?? []),
            ])],
          });
        }
      }
    }
    return result;
  }, [nodes, nodeMap]);

  return (
    <>
      {edges.map((edge, i) => (
        <Pipe key={i} edge={edge} dark={dark} onHoverLabel={onHoverLabel} />
      ))}
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
  onPipeLabel: (label: { text: string; x: number; y: number } | null) => void;
}

/** Tracks an in-progress fly-into animation. */
interface TransitionState {
  targetPath: string[];
  targetPos: THREE.Vector3;
  startPos: THREE.Vector3;
  startPivot: THREE.Vector3;
  startTime: number;
  duration: number;
}

function Scene({ root, inhabitedPath, dark, onNavigate, onHover, onSelect, onPipeLabel }: SceneProps) {
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

  const cameraDistance = inhabited.radius * 4.0;

  // Refs for camera/pivot — must be before callbacks that use them
  const cameraRef = useRef<THREE.Camera | null>(null);
  const pivotRef = useRef<THREE.Vector3 | null>(null);

  // Transition animation state
  const transitionRef = useRef<TransitionState | null>(null);
  const [dissolveKey, setDissolveKey] = useState<string | null>(null);
  const [dissolveProgress, setDissolveProgress] = useState(0);

  const handleEnter = useCallback((path: string[]) => {
    const targetNode = findNode(root, path);
    if (!targetNode) { onNavigate(path); return; }
    if (path.join("/") === inhabitedPath.join("/")) return;

    const camera = cameraRef.current;
    const pivot = pivotRef.current;
    if (!camera || !pivot) { onNavigate(path); return; }

    setDissolveKey(path.join("/"));
    setDissolveProgress(0);

    transitionRef.current = {
      targetPath: path,
      targetPos: new THREE.Vector3(...targetNode.position),
      startPos: camera.position.clone(),
      startPivot: pivot.clone(),
      startTime: performance.now(),
      duration: 600,
    };
  }, [root, inhabitedPath, onNavigate]);

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
        const isDissolvingTarget = nodeKey === dissolveKey;
        return (
          <SigilSphere
            key={nodeKey || "__root__"}
            node={node}
            isInhabited={isInhabited}
            isChild={isChild}
            dark={dark}
            onEnter={handleEnter}
            onHover={onHover}
            onSelect={onSelect}
            dissolve={isDissolvingTarget ? dissolveProgress : 0}
          />
        );
      })}

      <EntanglementLines nodes={visibleNodes} dark={dark} onHoverLabel={onPipeLabel} />

      <CameraHandler
        target={inhabited.position}
        distance={cameraDistance}
        inhabitedKey={inhabitedKey}
        cameraRef={cameraRef}
        pivotRef={pivotRef}
      />
      <TransitionAnimator
        transitionRef={transitionRef}
        cameraRef={cameraRef}
        pivotRef={pivotRef}
        onProgress={setDissolveProgress}
        onComplete={(path) => {
          setDissolveKey(null);
          setDissolveProgress(0);
          onNavigate(path);
        }}
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
  const [pipeLabel, setPipeLabel] = useState<{ text: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Escape goes up one level
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ws.currentPath.length > 0) {
        e.preventDefault();
        setPinnedNode(null);
        navigate(ws.currentPath.slice(0, -1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [ws.currentPath, navigate]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", background: dark ? "#0a0a14" : "#f0f0f8" }}>
      <Canvas
        camera={{ position: [1.8, -1.2, 6], fov: 39, near: 0.001, far: 200 }}
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
          onPipeLabel={setPipeLabel}
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
      {pipeLabel && containerRef.current && (() => {
        const rect = containerRef.current!.getBoundingClientRect();
        const x = pipeLabel.x - rect.left + 12;
        const y = pipeLabel.y - rect.top - 8;
        return (
        <div style={{
          position: "absolute",
          left: x,
          top: y,
          transform: "translateY(-100%)",
          background: dark ? "rgba(12,12,30,0.92)" : "rgba(255,255,255,0.96)",
          color: dark ? "#b0c0dd" : "#3a4a6a",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily: "system-ui, sans-serif",
          border: `1px solid ${dark ? "rgba(100,100,160,0.2)" : "rgba(0,0,0,0.08)"}`,
          boxShadow: dark ? "0 4px 16px rgba(0,0,0,0.5)" : "0 4px 16px rgba(0,0,0,0.1)",
          maxWidth: 360,
          pointerEvents: "none",
          zIndex: 10,
        }}>
          {pipeLabel.text}
        </div>
        );
      })()}
    </div>
  );
}

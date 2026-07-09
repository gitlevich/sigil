/**
 * StructuralView3D — the structural stance ("Outside").
 *
 * A sigil rendered as a sphere with one opening: the way back to its parent.
 * Children float inside as smaller spheres, entangled by lines where their
 * names co-occur in this sigil's narrative. Siblings — neighbors living in
 * parallel sigils, the parent's other children — sit on the wall and change
 * with the point of view: while the camera is inside my sphere they are
 * translucent bubbles overlapping mine (parallel sigils sharing a boundary);
 * once it pulls outside they become connections reaching out to those
 * neighboring sigils. At the app root the sphere has no opening.
 *
 * View from everywhere: orbit the camera freely. Double-click a child sphere
 * to focus on it; click the opening to ascend.
 *
 * Shared component: the host passes the resolved folder, the current path, the
 * roots, a navigate callback, and the theme. The editor and the web viewer
 * both wrap it with their own state.
 */
import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Line, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { findContext } from "../tree";
import { stripFrontmatter } from "../frontmatter";
import type { Sigil } from "../types";
import { extractArcs } from "../sentenceArcs";
import { fibonacciSphere, siblingWallPlacements, connectionNode } from "../structuralGeometry";

const FOCUSED_RADIUS = 10;
const CHILD_RADIUS_FRACTION = 0.14;
const CHILD_PLACEMENT_FRACTION = 0.55;
const NEIGHBOR_RADIUS = 2.6; // neighbor bubble, centered on the wall so it half-overlaps mine
const CONNECTION_LEN = 3.2; // how far a connection reaches out past the wall
const CONNECTION_NODE_RADIUS = 0.5; // the marker at the connection's far end
const OPENING_THETA = Math.PI * 0.82; // where the cap ends; south pole becomes the hole

export interface StructuralView3DProps {
  /** The currently-inhabited sigil. */
  folder: Sigil;
  /** Absolute path to the folder in the workspace tree. */
  currentPath: string[];
  /** Display name of the app root, used for the ascend label at depth 1. */
  rootName: string;
  /** Root of the main spec tree. */
  mainRoot: Sigil;
  /** Root of the imported-ontologies subtree, if any. */
  importedRoot?: Sigil | null;
  navigate: (path: string[]) => void;
  dark: boolean;
}

/** Ignore raycasts — visual-only labels never intercept clicks meant for the object. */
const noRaycast = () => {};

/**
 * Reports whether the camera has crossed inside the focused sphere. Reads the
 * camera each frame but only calls back on a transition, so the parent
 * re-renders when the point of view flips, not every frame.
 */
function CameraInsideProbe({ radius, onChange }: { radius: number; onChange: (inside: boolean) => void }) {
  const insideRef = useRef(false);
  useFrame(({ camera }) => {
    const inside = camera.position.length() < radius;
    if (inside !== insideRef.current) {
      insideRef.current = inside;
      onChange(inside);
    }
  });
  return null;
}

/**
 * A billboarded label — always faces the camera, so it is never edge-on or
 * mirrored. `frontOffset` floats it toward the camera by the object's radius
 * so it reads as painted on the object's near face. Visual only unless a
 * handler is passed.
 */
function SigilLabel({
  position,
  frontOffset = 0,
  fontSize,
  color,
  outlineColor,
  text,
  onClick,
}: {
  position: [number, number, number];
  frontOffset?: number;
  fontSize: number;
  color: string;
  outlineColor: string;
  text: string;
  onClick?: () => void;
}) {
  return (
    <Billboard position={position}>
      <Text
        position={[0, 0, frontOffset]}
        fontSize={fontSize}
        color={color}
        outlineWidth={fontSize * 0.08}
        outlineColor={outlineColor}
        anchorX="center"
        anchorY="middle"
        onClick={onClick}
        raycast={onClick ? undefined : noRaycast}
      >
        {text}
      </Text>
    </Billboard>
  );
}

export function StructuralView3D({
  folder,
  currentPath,
  rootName,
  mainRoot,
  importedRoot,
  navigate,
  dark,
}: StructuralView3DProps) {
  // Whether the camera has drifted inside the focused sphere — flips the
  // neighbor rendering between overlapping bubbles and outward connections.
  const [cameraInside, setCameraInside] = useState(false);

  // Children with positions on a fibonacci shell inside the focused sphere.
  const childPositions = useMemo(
    () => fibonacciSphere(folder?.children.length ?? 0, FOCUSED_RADIUS * CHILD_PLACEMENT_FRACTION),
    [folder?.children.length],
  );

  const hasParent = currentPath.length > 0;

  // Siblings — the parent's other children, placed on the wall away from the
  // opening so they don't crowd it. Rendered as bubbles or connections
  // depending on the point of view.
  const siblings = useMemo(() => {
    if (!folder || !hasParent) return [] as Sigil[];
    const parentPath = currentPath.slice(0, -1);
    const isImported = currentPath[0] === "Imported Ontologies";
    const root = (isImported ? importedRoot : mainRoot) as Sigil | undefined;
    if (!root) return [] as Sigil[];
    const relativePath = isImported ? parentPath.slice(1) : parentPath;
    const parent = findContext(root, relativePath);
    if (!parent) return [] as Sigil[];
    return parent.children.filter((c) => c.name !== folder.name) as Sigil[];
  }, [folder, hasParent, currentPath, mainRoot, importedRoot]);

  // Place sibling contact points on the upper hemisphere (away from the
  // south-pole opening). Fibonacci-on-cap: same spiral but over 0..OPENING_THETA.
  const siblingPlacements = useMemo(
    () => siblingWallPlacements(siblings.length, FOCUSED_RADIUS, OPENING_THETA),
    [siblings.length],
  );

  // Entanglements — sentence-level co-occurrence between named children,
  // lifted from the narrative. Drawn as straight 3D lines between child
  // positions. Dedupe per unordered pair.
  const entanglementLines = useMemo(() => {
    if (!folder || folder.children.length < 2) return [];
    const childNames = folder.children.map((c) => c.name);
    const text = stripFrontmatter(folder.language ?? "");
    const arcs = extractArcs(text, childNames, "sentence");
    const posByName = new Map<string, [number, number, number]>();
    folder.children.forEach((c, i) => posByName.set(c.name, childPositions[i]));
    const seen = new Set<string>();
    const lines: { a: [number, number, number]; b: [number, number, number] }[] = [];
    for (const arc of arcs) {
      const key = arc.a < arc.b ? `${arc.a}|${arc.b}` : `${arc.b}|${arc.a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pa = posByName.get(arc.a);
      const pb = posByName.get(arc.b);
      if (!pa || !pb) continue;
      lines.push({ a: pa, b: pb });
    }
    return lines;
  }, [folder, childPositions]);

  if (!folder) return null;

  const parentName = hasParent
    ? (currentPath.length > 1
        ? currentPath[currentPath.length - 2]
        : (currentPath[0] === "Imported Ontologies" ? "Imported Ontologies" : rootName))
    : null;

  // Opening rim — ring at the boundary of the cap cut-out.
  const openingRimY = FOCUSED_RADIUS * Math.cos(OPENING_THETA);
  const openingRimRadius = FOCUSED_RADIUS * Math.sin(OPENING_THETA);

  const childColor = dark ? "#6b8aa6" : "#7a9bb5";
  const wallColor = dark ? "#2a3440" : "#a8b8c8";
  const siblingColor = dark ? "#a99add" : "#9d8ec8"; // muted lavender — a distinct kind from the blue children
  const siblingRingColor = dark ? "#c7b8f2" : "#6d5ba6";
  const textColor = dark ? "#dde3ea" : "#2a333e";
  const labelOutline = dark ? "#10161c" : "#f5f6f7"; // scene background — a halo that lifts labels off any surface
  const edgeColor = dark ? "#8aa3bc" : "#4a6b8a";
  const rimColor = dark ? "#c0cad6" : "#5a6a7a";

  return (
    <div style={{ position: "absolute", inset: 0, background: dark ? "#10161c" : "#f5f6f7" }}>
      <Canvas
        camera={{ position: [0, 2, FOCUSED_RADIUS * 2.6], fov: 45 }}
        onCreated={({ gl, invalidate }) => {
          // Recover from WebGL context loss instead of dying with a blank,
          // broken canvas. React StrictMode's dev double-mount disposes the
          // renderer (forceContextLoss); the GPU can also drop the context
          // under memory pressure or tab backgrounding. Calling preventDefault
          // on the loss lets the browser fire `webglcontextrestored`, after
          // which we re-render the scene.
          const canvas = gl.domElement;
          canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); }, false);
          canvas.addEventListener("webglcontextrestored", () => { invalidate(); }, false);
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[12, 18, 12]} intensity={0.6} />
        <directionalLight position={[-12, -4, -8]} intensity={0.25} />

        <OrbitControls enablePan enableRotate enableZoom />

        <CameraInsideProbe radius={FOCUSED_RADIUS} onChange={setCameraInside} />

        {/* Focused sphere — translucent wall, cap removed at south pole when
            a parent exists. DoubleSide so we see inside and outside alike. */}
        <mesh>
          <sphereGeometry
            args={[FOCUSED_RADIUS, 72, 48, 0, Math.PI * 2, 0, hasParent ? OPENING_THETA : Math.PI]}
          />
          <meshStandardMaterial
            color={wallColor}
            transparent
            opacity={0.09}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Sphere meridians/parallels — faint wireframe that gives the wall
            its geometry without blocking the view of children inside. */}
        <mesh>
          <sphereGeometry
            args={[FOCUSED_RADIUS, 24, 16, 0, Math.PI * 2, 0, hasParent ? OPENING_THETA : Math.PI]}
          />
          <meshBasicMaterial color={wallColor} wireframe transparent opacity={0.18} />
        </mesh>

        {/* Opening rim + parent sign — the one door. */}
        {hasParent && (
          <group position={[0, openingRimY, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[openingRimRadius, 0.06, 12, 64]} />
              <meshBasicMaterial color={rimColor} />
            </mesh>
            <SigilLabel
              position={[0, -0.7, 0]}
              fontSize={0.5}
              color={textColor}
              outlineColor={labelOutline}
              text={`↑ ${parentName}`}
              onClick={() => navigate(currentPath.slice(0, -1))}
            />
          </group>
        )}

        {/* Entanglement lines — sentence-level co-occurrence between children. */}
        {entanglementLines.map((ln, i) => (
          <Line
            key={`ent-${i}`}
            points={[ln.a, ln.b]}
            color={edgeColor}
            lineWidth={1}
            transparent
            opacity={0.55}
          />
        ))}

        {/* Children — smaller spheres placed inside, each named on its face. */}
        {folder.children.map((child, i) => {
          const pos = childPositions[i];
          const r = FOCUSED_RADIUS * CHILD_RADIUS_FRACTION;
          return (
            <group key={`child-${child.name}`} position={pos}>
              <mesh
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  navigate([...currentPath, child.name]);
                }}
              >
                <sphereGeometry args={[r, 32, 24]} />
                <meshStandardMaterial color={childColor} roughness={0.6} metalness={0.05} />
              </mesh>
              <SigilLabel
                position={[0, 0, 0]}
                frontOffset={r + 0.05}
                fontSize={0.5}
                color={textColor}
                outlineColor={labelOutline}
                text={child.name}
              />
            </group>
          );
        })}

        {/* Neighbors — parallel sigils (the parent's other children), sitting
            on the wall. From inside they are translucent bubbles overlapping
            mine, at the same opacity as my own wall; from outside they become
            connections reaching out to those sigils. Double-click navigates
            to the neighbor either way. */}
        {siblings.map((sib, i) => {
          const { pos, inward } = siblingPlacements[i];
          const goToNeighbor = (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            navigate([...currentPath.slice(0, -1), sib.name]);
          };
          if (cameraInside) {
            // Bubble centered on the wall — half overlaps my space.
            return (
              <group key={`sib-${sib.name}`} position={pos}>
                <mesh onDoubleClick={goToNeighbor}>
                  <sphereGeometry args={[NEIGHBOR_RADIUS, 48, 32]} />
                  <meshStandardMaterial
                    color={siblingColor}
                    transparent
                    opacity={0.09}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                  />
                </mesh>
                <mesh>
                  <sphereGeometry args={[NEIGHBOR_RADIUS, 24, 16]} />
                  <meshBasicMaterial color={siblingColor} wireframe transparent opacity={0.2} />
                </mesh>
                <SigilLabel
                  position={[0, 0, 0]}
                  frontOffset={NEIGHBOR_RADIUS + 0.05}
                  fontSize={0.5}
                  color={textColor}
                  outlineColor={labelOutline}
                  text={sib.name}
                />
              </group>
            );
          }
          // Connection reaching out past the wall to the neighbor sigil.
          const node = connectionNode(pos, inward, CONNECTION_LEN);
          return (
            <group key={`sib-${sib.name}`}>
              <Line points={[pos, node]} color={siblingRingColor} lineWidth={1.5} transparent opacity={0.8} />
              <mesh position={node} onDoubleClick={goToNeighbor}>
                <sphereGeometry args={[CONNECTION_NODE_RADIUS, 24, 16]} />
                <meshStandardMaterial color={siblingColor} roughness={0.55} metalness={0.05} />
              </mesh>
              <SigilLabel
                position={node}
                frontOffset={CONNECTION_NODE_RADIUS + 0.05}
                fontSize={0.5}
                color={textColor}
                outlineColor={labelOutline}
                text={sib.name}
              />
            </group>
          );
        })}

        {/* Focused sigil's own name — floating above the sphere. */}
        <SigilLabel
          position={[0, FOCUSED_RADIUS + 1.2, 0]}
          fontSize={0.72}
          color={textColor}
          outlineColor={labelOutline}
          text={folder.name}
        />
      </Canvas>
    </div>
  );
}

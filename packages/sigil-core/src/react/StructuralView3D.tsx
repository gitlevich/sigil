/**
 * StructuralView3D — the structural stance ("Outside").
 *
 * A sigil rendered as a sphere with one opening: the way back to its parent.
 * Children float inside as smaller spheres, entangled by lines where their
 * names co-occur in this sigil's narrative. Siblings — the other children of
 * the parent — appear as flat named disks pressed into this sphere's inner
 * wall: they don't live here, but the wall holds their footprint. At the app
 * root the sphere has no opening.
 *
 * View from everywhere: orbit the camera freely. Double-click a child sphere
 * to focus on it; click the opening to ascend.
 *
 * Shared component: the host passes the resolved folder, the current path, the
 * roots, a navigate callback, and the theme. The editor and the web viewer
 * both wrap it with their own state.
 */
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import * as THREE from "three";
import { findContext } from "../tree";
import { stripFrontmatter } from "../frontmatter";
import type { Sigil } from "../types";
import { extractArcs } from "../sentenceArcs";

const FOCUSED_RADIUS = 10;
const CHILD_RADIUS_FRACTION = 0.14;
const CHILD_PLACEMENT_FRACTION = 0.55;
const WALL_DISK_RADIUS = 0.85;
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

/** Golden-angle spiral points on a sphere of given radius. */
function fibonacciSphere(n: number, radius: number): [number, number, number][] {
  if (n === 0) return [];
  if (n === 1) return [[0, 0, 0]];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const theta = GOLDEN * i;
    out.push([Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius]);
  }
  return out;
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
  // Children with positions on a fibonacci shell inside the focused sphere.
  const childPositions = useMemo(
    () => fibonacciSphere(folder?.children.length ?? 0, FOCUSED_RADIUS * CHILD_PLACEMENT_FRACTION),
    [folder?.children.length],
  );

  const hasParent = currentPath.length > 0;

  // Siblings — the parent's other children. Rendered as flat disks on the
  // inner wall, distributed on the remaining sphere area (away from the
  // opening so they don't crowd it).
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

  // Place sibling disks on the upper hemisphere (away from the south-pole
  // opening). Fibonacci-on-cap: same spiral but over 0..OPENING_THETA.
  const siblingPlacements = useMemo(() => {
    const n = siblings.length;
    if (n === 0) return [] as { pos: [number, number, number]; inward: THREE.Vector3 }[];
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    const thetaMax = OPENING_THETA - 0.08; // pull disks slightly clear of the rim
    const yMin = Math.cos(thetaMax);
    const yMax = Math.cos(0) - 0.001;
    const out: { pos: [number, number, number]; inward: THREE.Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
      const y = yMax - ((yMax - yMin) * (i + 0.5)) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN * i;
      const ux = Math.cos(theta) * r;
      const uz = Math.sin(theta) * r;
      const pos: [number, number, number] = [ux * FOCUSED_RADIUS, y * FOCUSED_RADIUS, uz * FOCUSED_RADIUS];
      const inward = new THREE.Vector3(-ux, -y, -uz).normalize();
      out.push({ pos, inward });
    }
    return out;
  }, [siblings.length]);

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
  const wallDiskColor = dark ? "#3a4555" : "#d8cfbf";
  const textColor = dark ? "#dde3ea" : "#2a333e";
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
            <Text
              position={[0, -0.6, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.42}
              color={textColor}
              anchorX="center"
              anchorY="middle"
              onClick={() => navigate(currentPath.slice(0, -1))}
            >
              ↑ {parentName}
            </Text>
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

        {/* Children — smaller spheres placed inside, each named. */}
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
              <Text
                position={[0, r + 0.35, 0]}
                fontSize={0.38}
                color={textColor}
                anchorX="center"
                anchorY="bottom"
              >
                {child.name}
              </Text>
            </group>
          );
        })}

        {/* Sibling wall disks — siblings of this sigil, printed on the inner
            wall because they live in parent space, not here. Oriented to
            face inward (toward the sphere center) so their labels read
            from the camera orbiting outside. */}
        {siblings.map((sib, i) => {
          const { pos, inward } = siblingPlacements[i];
          const quaternion = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            inward,
          );
          return (
            <group key={`sib-${sib.name}`} position={pos} quaternion={quaternion}>
              <mesh
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  navigate([...currentPath.slice(0, -1), sib.name]);
                }}
              >
                <circleGeometry args={[WALL_DISK_RADIUS, 48]} />
                <meshBasicMaterial color={wallDiskColor} side={THREE.DoubleSide} />
              </mesh>
              <Text
                position={[0, 0, 0.02]}
                fontSize={0.28}
                color={textColor}
                anchorX="center"
                anchorY="middle"
              >
                {sib.name}
              </Text>
            </group>
          );
        })}

        {/* Focused sigil's own name — floating above the sphere. */}
        <Text
          position={[0, FOCUSED_RADIUS + 0.9, 0]}
          fontSize={0.65}
          color={textColor}
          anchorX="center"
          anchorY="bottom"
        >
          {folder.name}
        </Text>
      </Canvas>
    </div>
  );
}

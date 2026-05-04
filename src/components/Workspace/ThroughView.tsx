/**
 * ThroughView — the POV stance.
 *
 * Attention in motion, traveling through branching pipes — the timelike
 * mode where time becomes visible. Placeholder while the experience is
 * being re-thought: POV must be from *inside* the pipes, not a third-person
 * view of a junction.
 */
export function ThroughView() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-secondary)",
        fontSize: "0.9rem",
        letterSpacing: "0.02em",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div>
        <div style={{ fontSize: "1.1rem", marginBottom: "0.4rem" }}>Through</div>
        <div>POV — attention traveling through branching pipes. Not yet built.</div>
      </div>
    </div>
  );
}

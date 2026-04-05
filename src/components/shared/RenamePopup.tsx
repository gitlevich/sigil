interface RenamePopupProps {
  oldName: string;
  kind: "sigil" | "affordance" | "invariant";
  x: number;
  y: number;
  onRename: (kind: "sigil" | "affordance" | "invariant", oldName: string, newName: string) => void;
  onClose: () => void;
}

export function RenamePopup({ oldName, kind, x, y, onRename, onClose }: RenamePopupProps) {
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 100 }}>
      <input
        autoFocus
        defaultValue={oldName}
        style={{
          padding: "2px 6px",
          fontSize: "13px",
          border: "1px solid var(--accent)",
          borderRadius: "3px",
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          outline: "none",
          minWidth: "120px",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const newName = e.currentTarget.value.trim();
            if (newName && newName !== oldName) {
              onRename(kind, oldName, newName);
            }
            onClose();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onBlur={onClose}
      />
    </div>
  );
}

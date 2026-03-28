import { useCallback, useRef } from "react";
import styles from "./ResizeHandle.module.css";

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (delta: number) => void;
}

export function ResizeHandle({ side, onResize }: ResizeHandleProps) {
  const startXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startXRef.current;
        startXRef.current = moveEvent.clientX;
        // For a right-edge handle: positive delta = grow
        // For a left-edge handle: negative delta = grow (inverted)
        onResize(side === "right" ? delta : -delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onResize, side]
  );

  return (
    <div
      className={`${styles.handle} ${side === "right" ? styles.right : styles.left}`}
      onMouseDown={handleMouseDown}
    />
  );
}

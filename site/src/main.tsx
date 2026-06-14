import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// No StrictMode: its dev-only double-mount disposes the react-three-fiber WebGL
// context (forceContextLoss) and the remount cannot recover a context on the
// poisoned canvas, leaving the Space "Outside" 3D view blank in development.
// StrictMode is a no-op in production, so this only affects the dev double-pass.
createRoot(document.getElementById("root")!).render(
  <App />
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./state/AppContext";
import { ToastProvider } from "./components/shared/ToastContainer";
import { getInitialRootPath } from "./tauri";
import "./styles/global.css";

const initialRootPath = getInitialRootPath();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <ToastProvider>
        <App initialRootPath={initialRootPath} />
      </ToastProvider>
    </AppProvider>
  </StrictMode>,
);

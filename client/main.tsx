import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@markweave/editor-core/styles.css";
import "./styles/global.css";
import App from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

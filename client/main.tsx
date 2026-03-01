import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "tiptap-markdown-editor/dist/tiptap-markdown-editor.css";
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

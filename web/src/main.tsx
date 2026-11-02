import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("No se encontro el contenedor #root");
}

createRoot(container).render(<App />);

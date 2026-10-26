import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { App } from "./App.jsx";
import "@radix-ui/themes/styles.css";
import "katex/dist/katex.min.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <Theme accentColor="gray" grayColor="gray" radius="large" panelBackground="solid" style={{ height: "100%", background: "#e8e8e8" }}>
    <App />
  </Theme>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <p className="eyebrow">宝石寄售</p>
      <h1>前端游戏工程已启动</h1>
      <p>下一步接入完整规则、双人模式、人机模式和视觉资产。</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

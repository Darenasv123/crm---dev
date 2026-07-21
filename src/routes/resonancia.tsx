import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/resonancia")({
  head: () => ({
    meta: [{ title: "RESONANCIA — Puzzle de Ecos" }],
  }),
  component: ResonanciaRedirect,
});

function ResonanciaRedirect() {
  useEffect(() => {
    window.location.replace("/resonancia/index.html");
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a12",
        color: "#00f5ff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      Cargando RESONANCIA...
    </div>
  );
}

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));
const sw = readFileSync("public/sw.js", "utf8");
const rootSource = readFileSync("src/routes/__root.tsx", "utf8");

function pngDimensions(path: string): { width: number; height: number } {
  const buf = Buffer.alloc(24);
  const fd = openSync(path, "r");
  readSync(fd, buf, 0, 24, 0);
  closeSync(fd);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("Fase 7 — Manifest: los tamaños declarados coinciden con las dimensiones reales del PNG", () => {
  for (const icon of manifest.icons) {
    it(`${icon.src} declara ${icon.sizes} y el archivo real mide exactamente eso`, () => {
      const [declaredW, declaredH] = icon.sizes.split("x").map(Number);
      const filePath = `public${icon.src}`;
      expect(() => statSync(filePath)).not.toThrow();
      const { width, height } = pngDimensions(filePath);
      expect(width).toBe(declaredW);
      expect(height).toBe(declaredH);
    });
  }

  it("los íconos 192 y 512 son maskable (requisito de instalabilidad)", () => {
    const icon192 = manifest.icons.find((i: { sizes: string }) => i.sizes === "192x192");
    const icon512 = manifest.icons.find((i: { sizes: string }) => i.sizes === "512x512");
    expect(icon192.purpose).toContain("maskable");
    expect(icon512.purpose).toContain("maskable");
  });

  it("manifest declara los campos mínimos de instalabilidad", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
  });
});

describe("Fase 7 — Service worker: nunca cachea endpoints autenticados/sensibles", () => {
  it("excluye explícitamente Supabase, Groq y Google por hostname", () => {
    expect(sw).toMatch(/supabase\.co/);
    expect(sw).toMatch(/groq\.com/);
    expect(sw).toMatch(/googleapis\.com/);
  });

  it("excluye explícitamente los métodos no-GET (mutaciones)", () => {
    expect(sw).toContain('request.method !== "GET"');
  });

  it("la única rama que escribe en caché (cache.put) es la de assets estáticos por extensión/carpeta, no una rama genérica de red", () => {
    const putCalls = sw.match(/cache\.put\(/g) ?? [];
    expect(putCalls).toHaveLength(1);
    const putIndex = sw.indexOf("cache.put(");
    const staticBranchIndex = sw.indexOf('url.pathname.startsWith("/assets/")');
    const navigateBranchIndex = sw.indexOf('request.mode === "navigate"');
    expect(staticBranchIndex).toBeGreaterThan(-1);
    expect(putIndex).toBeGreaterThan(staticBranchIndex);
    expect(putIndex).toBeLessThan(navigateBranchIndex);
  });

  it("activate limpia cachés antiguas (no acumula versiones para siempre)", () => {
    const activateBlock = sw.slice(sw.indexOf('addEventListener("activate"'));
    expect(activateBlock).toContain("caches.delete");
  });
});

describe("Fase 7 — registro del service worker y meta viewport", () => {
  it("registra /sw.js de forma best-effort (no bloquea si falla)", () => {
    expect(rootSource).toContain('navigator.serviceWorker.register("/sw.js"');
  });

  it("el viewport no bloquea el zoom del usuario (accesibilidad)", () => {
    const viewportLine = rootSource.split("\n").find((line) => line.includes('name: "viewport"'));
    expect(viewportLine).toBeDefined();
    expect(viewportLine).not.toMatch(/user-scalable=no/);
    expect(viewportLine).not.toMatch(/maximum-scale=1(?!\.)/);
  });
});

describe("Fase 7 — beforeinstallprompt: instalación honesta, sin botón falso", () => {
  const source = readFileSync("src/components/install-prompt.tsx", "utf8");

  it("escucha el evento real beforeinstallprompt en vez de mostrar un botón siempre visible", () => {
    expect(source).toContain('addEventListener("beforeinstallprompt"');
  });

  it("no ofrece instalación cuando ya corre en modo standalone", () => {
    expect(source).toMatch(/isStandalone/);
    expect(source).toContain("display-mode: standalone");
  });

  it("en iOS (que nunca dispara beforeinstallprompt) muestra solo instrucciones de texto, no invoca una API de instalación", () => {
    const ternaryStart = source.indexOf("{deferredEvent ? (");
    const elseBranchStart = source.indexOf(") : (", ternaryStart);
    const elseBranchEnd = source.indexOf(")}", elseBranchStart);
    const iosBranch = source.slice(elseBranchStart, elseBranchEnd);
    expect(iosBranch).toContain("iPhone/iPad");
    expect(iosBranch).not.toContain(".prompt()");
  });

  it("el botón de instalar solo aparece cuando existe un evento diferido real capturado", () => {
    expect(source).toMatch(/deferredEvent \? \(/);
    expect(source).toContain("deferredEvent.prompt()");
  });
});

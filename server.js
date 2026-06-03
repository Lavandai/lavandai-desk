const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

// Carica .env se presente (in locale)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  });
}

const PORT    = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

if (!API_KEY) {
  console.error("\n❌  ANTHROPIC_API_KEY non trovata nelle variabili d'ambiente.");
  console.error("    Su Railway: Settings → Variables → ANTHROPIC_API_KEY\n");
  process.exit(1);
}

console.log("✅  Chiave API trovata:", API_KEY.slice(0, 16) + "...");

// ─── MIME ─────────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
};

// ─── Static ───────────────────────────────────────────────────────────────────
const FRONTEND = path.resolve(__dirname);

function serveStatic(req, res) {
  const reqPath = req.url.split("?")[0];
  let filePath  = path.join(FRONTEND, reqPath === "/" ? "index.html" : reqPath);
  if (!filePath.startsWith(FRONTEND)) { res.writeHead(403); res.end("Forbidden"); return; }
  if (!fs.existsSync(filePath)) filePath = path.join(FRONTEND, "index.html");
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

// ─── Proxy ────────────────────────────────────────────────────────────────────
function proxyChat(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST")    { res.writeHead(405); res.end("Method Not Allowed"); return; }

  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);

    // Valida JSON
    try { JSON.parse(body.toString()); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "JSON non valido" })); return;
    }

    const options = {
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length":    body.length,
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      console.log(`[Anthropic] status: ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("[Anthropic] errore:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });

  req.on("error", (err) => {
    console.error("[Request] errore:", err.message);
    res.writeHead(500); res.end();
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  if (req.url.startsWith("/api/")) {
    proxyChat(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🫧  LavandAI Desk → http://localhost:${PORT}\n`);
});

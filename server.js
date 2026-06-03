// ─────────────────────────────────────────────────────────────────────────────
// LavandAI Desk — Backend proxy server
// Node.js 18+  |  nessuna dipendenza esterna richiesta
// ─────────────────────────────────────────────────────────────────────────────
const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

// Carica .env manualmente (non serve dotenv)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach(line => {
      const [k, ...v] = line.split("=");
      if (k && v.length) process.env[k.trim()] = v.join("=").trim();
    });
}

const PORT    = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

if (!API_KEY) {
  console.error("\n❌  ANTHROPIC_API_KEY non trovata.");
  console.error("    Crea il file backend/.env e aggiungi:");
  console.error("    ANTHROPIC_API_KEY=sk-ant-...\n");
  process.exit(1);
}

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".woff2":"font/woff2",
};

// ─── Static file server ───────────────────────────────────────────────────────
const FRONTEND = path.resolve(__dirname, "frontend");

function serveStatic(req, res) {
  const reqPath = req.url.split("?")[0];
  let filePath  = path.join(FRONTEND, reqPath === "/" ? "index.html" : reqPath);

  // Sicurezza: evita directory traversal
  if (!filePath.startsWith(FRONTEND)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  if (!fs.existsSync(filePath)) {
    // SPA fallback → serve index.html
    filePath = path.join(FRONTEND, "index.html");
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

// ─── Anthropic proxy ──────────────────────────────────────────────────────────
function proxyChat(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST")    { res.writeHead(405); res.end("Method Not Allowed"); return; }

  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    // Validazione minimale
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "JSON non valido" })); return;
    }

    const payload = JSON.stringify(parsed);

    const options = {
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length":  Buffer.byteLength(payload),
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Errore proxy Anthropic:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Errore di connessione al server AI" }));
    });

    proxyReq.write(payload);
    proxyReq.end();
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const ts = new Date().toLocaleTimeString("it-IT");
  console.log(`[${ts}] ${req.method} ${req.url}`);

  if (req.url.startsWith("/api/chat")) {
    proxyChat(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🫧  LavandAI Desk avviato`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → http://<IP-RETE>:${PORT}  (accesso da altri dispositivi)\n`);
});

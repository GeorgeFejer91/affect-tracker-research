import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
});

const siteRoot = resolve(import.meta.dirname, "../experiment-planner/web");
const port = Number.parseInt(process.env.PORT ?? "8000", 10);
const host = process.env.HOST ?? "127.0.0.1";

function responseType(file) {
  return MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function resolveSitePath(pathname) {
  const requested = decodeURIComponent(pathname);
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/u, "");
  const file = resolve(siteRoot, relative);
  if (file !== siteRoot && !file.startsWith(siteRoot + sep)) {
    throw new Error("Path escapes site root.");
  }
  return file;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    let file = resolveSitePath(url.pathname);
    const details = await stat(file);
    if (details.isDirectory()) file = join(file, "index.html");
    response.setHeader("Content-Type", responseType(file));
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${siteRoot} at http://${host}:${port}/`);
});

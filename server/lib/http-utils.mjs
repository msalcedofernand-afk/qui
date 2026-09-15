import fs from "node:fs";
import path from "node:path";

export function sendJson(res, status, body) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'"
  };
  const cookie = res.getHeader("set-cookie");
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

export async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("request_body_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function resolveStaticFile(root, pathname) {
  const file = path.resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  const relative = path.relative(path.resolve(root), file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? file : pathname === "/" ? file : null;
}

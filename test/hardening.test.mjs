import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { readBody, resolveStaticFile } from "../server/lib/http-utils.mjs";
import { readJson, writeJson } from "../server/lib/json-store.mjs";

test("JSON store replaces data atomically", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "redmi-json-"));
  const file = path.join(directory, "nested", "state.json");
  try {
    writeJson(file, { activeProfile: "minecraft" });
    assert.deepEqual(readJson(file, {}), { activeProfile: "minecraft" });
    assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("HTTP helpers reject oversized bodies and path traversal", async () => {
  await assert.rejects(readBody(Readable.from([Buffer.alloc(9)]), 8), /request_body_too_large/);
  assert.equal(resolveStaticFile("/srv/web", "/../secret"), null);
  assert.equal(resolveStaticFile("/srv/web", "/app.js"), path.resolve("/srv/web/app.js"));
});

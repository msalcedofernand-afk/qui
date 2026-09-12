import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("control plane health and auth boundary", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "redmi-control-test-"));
  const child = spawn(process.execPath, ["server/index.mjs"], { env: { ...process.env, PORT: "43127", ADMIN_TOKEN: "test-token-123456", DATA_DIR: dataDir } });
  await new Promise(resolve => setTimeout(resolve, 350));
  try {
    const health = await fetch("http://127.0.0.1:43127/api/health");
    assert.equal(health.status, 200);
    const denied = await fetch("http://127.0.0.1:43127/api/stats/live");
    assert.equal(denied.status, 401);
    const ok = await fetch("http://127.0.0.1:43127/api/profiles", { headers: { authorization: "Bearer test-token-123456" } });
    assert.equal(ok.status, 200);
    const payload = await ok.json();
    assert.ok(payload.data.some(profile => profile.id === "minecraft"));
    const created = await fetch("http://127.0.0.1:43127/api/access/devices", { method: "POST", headers: { authorization: "Bearer test-token-123456", "content-type": "application/json" }, body: JSON.stringify({ name: "Test viewer", role: "viewer", allowedIp: "127.0.0.1" }) });
    assert.equal(created.status, 201);
    const issued = await created.json();
    assert.ok(issued.token);
    assert.equal("tokenHash" in issued.data, false);
    const viewerRead = await fetch("http://127.0.0.1:43127/api/profiles", { headers: { authorization: `Bearer ${issued.token}` } });
    assert.equal(viewerRead.status, 200);
    const viewerWrite = await fetch("http://127.0.0.1:43127/api/profiles/normal/activate", { method: "POST", headers: { authorization: `Bearer ${issued.token}` } });
    assert.equal(viewerWrite.status, 403);
    const revoked = await fetch(`http://127.0.0.1:43127/api/access/devices/${issued.data.id}`, { method: "DELETE", headers: { authorization: "Bearer test-token-123456" } });
    assert.equal(revoked.status, 200);
    const deniedAfterRevoke = await fetch("http://127.0.0.1:43127/api/profiles", { headers: { authorization: `Bearer ${issued.token}` } });
    assert.equal(deniedAfterRevoke.status, 401);
  } finally { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

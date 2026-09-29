import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearStalePgliteLock } from "../src/drassos.ts";

describe("PGlite lock file", () => {
  it("removes a postmaster.pid whose process is gone so the engine can start again", () => {
    const root = path.join(os.tmpdir(), `drassos-pglite-${crypto.randomUUID()}`);
    const pidFile = path.join(root, "pglite", "postmaster.pid");
    mkdirSync(path.dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, "999999\n/tmp/pglite\n", "utf8");

    clearStalePgliteLock(root, () => false);

    expect(() => readFileSync(pidFile)).toThrow();
  });

  it("keeps the lock while the recorded process is still alive", () => {
    const root = path.join(os.tmpdir(), `drassos-pglite-${crypto.randomUUID()}`);
    const pidFile = path.join(root, "pglite", "postmaster.pid");
    mkdirSync(path.dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, `${process.pid}\n`, "utf8");

    clearStalePgliteLock(root, (pid) => pid === process.pid);

    expect(readFileSync(pidFile, "utf8")).toContain(String(process.pid));
  });
});

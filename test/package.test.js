import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");

test("Typert protocol is a peer dependency so Host Remotes share one marker registry", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(packageJson.dependencies?.["@deepseek-ai/dsh-typert-protocol"], undefined);
  assert.equal(packageJson.peerDependencies?.["@deepseek-ai/dsh-typert-protocol"], "^0.1.0-rc.6");
});

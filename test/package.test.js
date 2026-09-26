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

test("DSH LLM adapter API is a peer dependency so the host supplies LlmAdapter", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(packageJson.dependencies?.["@deepseek-ai/dsh-llm"], undefined);
  assert.equal(
    packageJson.peerDependencies?.["@deepseek-ai/dsh-llm"],
    "^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2 || ^0.1.3-alpha.2 || ^0.1.5-alpha.1 || ^0.1.6-alpha.1 || ^0.1.7-rc.1",
  );
});

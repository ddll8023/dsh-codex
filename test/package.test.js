import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_REMOTE } from "../lib/protocol.js";
import { TYPERT } from "../lib/typert.host.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packagePath = resolve(testDirectory, "../package.json");
const clientPath = resolve(testDirectory, "../lib/client.js");

test("Typert protocol is a peer dependency so Host Remotes share one marker registry", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(packageJson.dependencies?.["@deepseek-ai/dsh-typert-protocol"], undefined);
  assert.equal(packageJson.peerDependencies?.["@deepseek-ai/dsh-typert-protocol"], "^0.1.7-rc.1");
});

function collectCodecs(invocations) {
  return invocations.flatMap(({ result, parameters = [] }) => [
    result,
    ...parameters.map((parameter) => parameter.codec).filter((codec) => codec !== undefined),
  ]);
}

test("Typert strict codecs use the latest create-only contract", () => {
  const codecs = [
    ...collectCodecs(TYPERT.invocations),
    ...collectCodecs(CODEX_REMOTE.descriptors),
  ];
  for (const codec of codecs) {
    assert.equal(typeof codec.create, "function");
    assert.equal(typeof codec.create().parse, "function");
    assert.equal("schema" in codec, false);
  }

  const clientSource = readFileSync(clientPath, "utf8");
  assert.doesNotMatch(clientSource, /schema\s*:/);
  assert.match(clientSource, /create:\s*\(\)\s*=>\s*schema/);
});

test("DSH LLM adapter API is a peer dependency so the host supplies LlmAdapter", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(packageJson.dependencies?.["@deepseek-ai/dsh-llm"], undefined);
  assert.equal(
    packageJson.peerDependencies?.["@deepseek-ai/dsh-llm"],
    "^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2 || ^0.1.3-alpha.2 || ^0.1.5-alpha.1 || ^0.1.6-alpha.1 || ^0.1.7-rc.1",
  );
});

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
  assert.equal(packageJson.peerDependencies?.["@deepseek-ai/dsh-typert-protocol"], "^0.1.7-rc.2");
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

test("DSH LLM adapter API is a current-host peer so the host supplies LlmAdapter", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(packageJson.dependencies?.["@deepseek-ai/dsh-llm"], undefined);
  assert.equal(packageJson.peerDependencies?.["@deepseek-ai/dsh-llm"], "^0.1.7-rc.2");
});

test("DSH package dependencies match Desktop 0.1.7-rc.2 and omit removed client runtime", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  for (const name of [
    "@deepseek-ai/dsh-credentials",
    "@deepseek-ai/dsh-invariants",
    "@deepseek-ai/dsh-scope",
    "@deepseek-ai/dsh-settings",
    "@deepseek-ai/dsh-session",
    "@deepseek-ai/dsh-timeout",
  ]) {
    assert.equal(packageJson.dependencies?.[name], "^0.1.7-rc.2", `${name} dependency version`);
  }
  for (const name of [
    "@deepseek-ai/dsh-api-remotes",
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-model-selection",
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-client-ui-commands",
    "@deepseek-ai/dsh-client-ui-slots",
    "@deepseek-ai/dsh-typert-protocol",
  ]) {
    assert.equal(packageJson.peerDependencies?.[name], "^0.1.7-rc.2", `${name} peer version`);
  }
  assert.equal(packageJson.peerDependencies?.["@deepseek-ai/dsh-client-runtime"], undefined);
  assert.equal(packageJson.dsh.client.inject.includes("@deepseek-ai/dsh-client-runtime"), false);
});

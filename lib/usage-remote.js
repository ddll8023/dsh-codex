/**
 * Host-side Remote service for the Codex account usage panel.
 *
 * The browser receives only the parsed quota snapshot. OAuth access tokens stay
 * inside the Host credential seam and are never part of the Remote payload.
 *
 * @module dsh-codex/usage-remote
 */

import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { CODEX_USAGE_REMOTE } from "./protocol.js";

const remoteInitializers = [];
for (const d of CODEX_USAGE_REMOTE.descriptors) {
  Remote(d.method)(undefined, {
    private: false,
    static: false,
    name: d.method,
    addInitializer(initializer) { remoteInitializers.push(initializer); },
  });
}

/** Host Remote namespace: `ctx.remote.codexUsage.get()`. */
export class CodexUsageService extends TypertRemoteService {
  constructor(ctx, config = {}) {
    super(ctx, "codexUsage");
    this.readUsage = config.readUsage;
    if (typeof this.readUsage !== "function") {
      throw new TypeError("dsh-codex: CodexUsageService requires a readUsage function");
    }
    for (const initializer of remoteInitializers) initializer.call(this);
  }

  /** Return a token-free account usage snapshot or an explicit unavailable state. */
  async get() {
    return this.readUsage();
  }
}

/**
 * Host-side Remote service for the Codex account usage panel.
 *
 * The browser receives only the parsed quota snapshot. OAuth access tokens stay
 * inside the Host credential seam and are never part of the Remote payload.
 *
 * @module dsh-codex/usage-remote
 */

import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

/**
 * The source package is JavaScript-only, while Typert normally marks methods
 * during TypeScript compilation. Apply the same public Remote marker once to
 * the service prototype without requiring a build-time decorator transform.
 */
const remoteInitializers = [];
Remote("get")(undefined, {
  private: false,
  static: false,
  name: "get",
  addInitializer(initializer) {
    remoteInitializers.push(initializer);
  },
});

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

/**
 * Host Remote for Codex account management (used by the Settings page).
 *
 * Browser receives only token-free snapshots. OAuth access tokens never leave
 * the Host credential seam.
 *
 * @module dsh-codex/account-remote
 */

import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

const remoteInitializers = [];
for (const name of ["getStatus", "startLogin", "cancelLogin", "logout", "refreshUsage"]) {
  Remote(name)(undefined, {
    private: false,
    static: false,
    name,
    addInitializer(initializer) {
      remoteInitializers.push(initializer);
    },
  });
}

/**
 * Codex account Host Remote.
 * Config: { getStatus, startLogin, cancelLogin, logout, refreshUsage }
 */
export class CodexAccountService extends TypertRemoteService {
  constructor(ctx, config = {}) {
    super(ctx, "codexAccount");
    this._getStatus = config.getStatus;
    this._startLogin = config.startLogin;
    this._cancelLogin = config.cancelLogin;
    this._logout = config.logout;
    this._refreshUsage = config.refreshUsage;
    if (
      typeof this._getStatus !== "function" ||
      typeof this._startLogin !== "function" ||
      typeof this._cancelLogin !== "function" ||
      typeof this._logout !== "function" ||
      typeof this._refreshUsage !== "function"
    ) {
      throw new TypeError("dsh-codex: CodexAccountService requires getStatus/startLogin/cancelLogin/logout/refreshUsage");
    }
    for (const initializer of remoteInitializers) initializer.call(this);
  }

  async getStatus() {
    return this._getStatus();
  }

  async startLogin(input) {
    return this._startLogin(input);
  }

  async cancelLogin() {
    return this._cancelLogin();
  }

  async logout() {
    return this._logout();
  }

  async refreshUsage() {
    return this._refreshUsage();
  }
}

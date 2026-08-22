/* Hand-written Typert Host manifest for the dsh-codex Remote services. */
import { z } from "zod";

const usageResultSchema = z.object({
  status: z.union([z.literal("ok"), z.literal("not_logged_in"), z.literal("unavailable")]),
}).passthrough();

const accountStatusSchema = z.object({
  loggedIn: z.boolean(),
  pending: z.object({ method: z.string() }).passthrough().nullable().optional(),
}).passthrough();

const loginInputSchema = z.object({
  method: z.union([z.literal("browser"), z.literal("device_code")]),
}).passthrough();

const anyResult = z.any();

const usageResult = {
  mode: "strict",
  typeSymbol: "dsh-codex#CodexUsageResult",
  schema: usageResultSchema,
};

const accountStatusResult = {
  mode: "strict",
  typeSymbol: "dsh-codex#CodexAccountStatus",
  schema: accountStatusSchema,
};

const loginInput = {
  mode: "strict",
  typeSymbol: "dsh-codex#CodexLoginInput",
  schema: loginInputSchema,
};

const genericResult = {
  mode: "strict",
  typeSymbol: "dsh-codex#CodexRemoteResult",
  schema: anyResult,
};

const direct = { kind: "direct" };
const noParameters = [];

function service(key, exportName, members) {
  return {
    description: `Host Remote service ${key}.`,
    summary: `Codex ${key} Remote service.`,
    tags: [],
    jsDoc: `/** Codex ${key} Remote service. */`,
    key,
    exportName,
    members: members.map((name) => ({
      kind: "method",
      name,
      signature: `@Remote('${name}') async ${name}(): Promise<unknown>`,
      summary: `Invoke ${key}/${name}.`,
      jsDoc: `/** Invoke ${key}/${name}. */`,
    })),
    types: [],
  };
}

export const TYPERT = {
  package: "dsh-codex",
  face: "host",
  schemas: [],
  invocations: [
    {
      id: "dsh-codex#codexUsage/get",
      service: "codexUsage",
      namespace: "codexUsage",
      method: "get",
      invocation: direct,
      parameters: noParameters,
      result: usageResult,
    },
    {
      id: "dsh-codex#codexAccount/getStatus",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "getStatus",
      invocation: direct,
      parameters: noParameters,
      result: accountStatusResult,
    },
    {
      id: "dsh-codex#codexAccount/startLogin",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "startLogin",
      invocation: direct,
      parameters: [{ name: "input", wire: "input", source: "json", codec: loginInput }],
      result: genericResult,
    },
    {
      id: "dsh-codex#codexAccount/cancelLogin",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "cancelLogin",
      invocation: direct,
      parameters: noParameters,
      result: genericResult,
    },
    {
      id: "dsh-codex#codexAccount/logout",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "logout",
      invocation: direct,
      parameters: noParameters,
      result: genericResult,
    },
    {
      id: "dsh-codex#codexAccount/getUsage",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "getUsage",
      invocation: direct,
      parameters: noParameters,
      result: usageResult,
    },
    {
      id: "dsh-codex#codexAccount/refreshUsage",
      service: "codexAccount",
      namespace: "codexAccount",
      method: "refreshUsage",
      invocation: direct,
      parameters: noParameters,
      result: usageResult,
    },
  ],
  model: {
    services: [
      service("codexUsage", "CodexUsageService", ["get"]),
      service("codexAccount", "CodexAccountService", ["getStatus", "startLogin", "cancelLogin", "logout", "getUsage", "refreshUsage"]),
    ],
    events: [],
    objects: [],
  },
};

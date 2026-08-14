import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, isAIMessage, type BaseMessageLike } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { ModelRole, UsageEntry } from "../graph/state.ts";
import { toUsageEntry } from "./ledger.ts";

export const PROVIDERS = ["anthropic", "openai", "gemini", "openrouter"] as const;

export type Provider = (typeof PROVIDERS)[number];

/**
 * Used when neither `--provider` nor `LLM_PROVIDER` names one. Whoever runs the
 * agent without arguments needs this provider's credential and no other.
 */
export const DEFAULT_PROVIDER: Provider = "anthropic";

interface ProviderConfig {
  /** The one variable this provider needs. No provider reads another's. */
  apiKeyVar: string;
  /** `null` selects the native adapter; a URL selects the OpenAI-compatible one. */
  baseUrl: string | null;
  /** `null` where no default has been exercised, so a model must be supplied. */
  defaultModels: Record<ModelRole, string> | null;
}

const CONFIG: Record<Provider, ProviderConfig> = {
  anthropic: {
    apiKeyVar: "ANTHROPIC_API_KEY",
    baseUrl: null,
    defaultModels: {
      planner: "claude-opus-5",
      coder: "claude-opus-5",
      reviewer: "claude-sonnet-5",
    },
  },
  openai: {
    apiKeyVar: "OPENAI_API_KEY",
    baseUrl: null,
    defaultModels: {
      planner: "gpt-5.6-sol",
      coder: "gpt-5.6-sol",
      reviewer: "gpt-5.6-terra",
    },
  },
  gemini: {
    apiKeyVar: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModels: null,
  },
  openrouter: {
    apiKeyVar: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModels: null,
  },
};

/** Ceiling on one response. Not a sampling parameter: none are ever sent. */
const MAX_OUTPUT_TOKENS = 16_000;

/** `planner` reads `PLANNER_MODEL`, and so on. */
function modelEnvVar(role: ModelRole): string {
  return `${role.toUpperCase()}_MODEL`;
}

/**
 * Resolves the credential for the selected provider only, and fails here —
 * before any network call — naming the exact variable to define.
 */
export function requireApiKey(provider: Provider): string {
  const { apiKeyVar } = CONFIG[provider];
  const key = process.env[apiKeyVar];
  if (key === undefined || key === "") {
    throw new Error(
      `Provider "${provider}" needs ${apiKeyVar}, which is not set. ` +
        `Define it in .env (see .env.example), or select another provider with --provider.`,
    );
  }
  return key;
}

function resolveModelId(
  provider: Provider,
  role: ModelRole,
  override: string | undefined,
): string {
  const fromEnv = process.env[modelEnvVar(role)];
  const chosen = override ?? (fromEnv === "" ? undefined : fromEnv);
  if (chosen !== undefined) {
    return chosen;
  }

  const { defaultModels } = CONFIG[provider];
  if (defaultModels === null) {
    throw new Error(
      `Provider "${provider}" ships no default model for the ${role} role. ` +
        `Name one with --model, or set ${modelEnvVar(role)}.`,
    );
  }
  return defaultModels[role];
}

/** A rejection of the model itself, as opposed to a transport or quota failure. */
function isModelAccessError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  return error.status === 403 || error.status === 404;
}

export interface ModelResponse {
  text: string;
  usage: UsageEntry;
}

export interface StructuredResponse {
  /**
   * Unvalidated on purpose. The provider enforces the schema it was given, but
   * `strict` is honoured by one adapter only and no JSON Schema can state a
   * cross-field rule, so the caller validates before use.
   */
  value: unknown;
  usage: UsageEntry;
}

export interface ModelClient {
  readonly modelId: string;
  /**
   * `text` as a message that ends the part of the prompt worth caching.
   *
   * The caller decides *what* is stable; the provider decides *how* that is
   * expressed, which is why this lives here. Everything sent before and
   * including this message is cached; everything after it is not.
   */
  cacheable(text: string): BaseMessageLike;
  /** `node` names the graph node spending, so the ledger attributes the cost. */
  invoke(node: string, messages: BaseMessageLike[]): Promise<ModelResponse>;
  /** Same call, with the answer's shape enforced by `schema` rather than asked for in prose. */
  invokeStructured(
    node: string,
    messages: BaseMessageLike[],
    schema: Record<string, unknown>,
  ): Promise<StructuredResponse>;
}

export interface ModelOptions {
  provider: Provider;
  role: ModelRole;
  /** From `--model`; falls back to the role's variable, then the default. */
  model: string | undefined;
  /** From `--cache`. False places no breakpoint, so nothing is written or read. */
  promptCache: boolean;
}

/**
 * One interface over two adapters: the native one, and an OpenAI-compatible one
 * whose base URL selects among the remaining providers.
 */
export function createModel(options: ModelOptions): ModelClient {
  const { provider, role, promptCache } = options;
  const apiKey = requireApiKey(provider);
  const modelId = resolveModelId(provider, role, options.model);
  const { baseUrl } = CONFIG[provider];

  const chat =
    provider === "anthropic"
      ? new ChatAnthropic({ model: modelId, apiKey, maxTokens: MAX_OUTPUT_TOKENS })
      : new ChatOpenAI({
          model: modelId,
          apiKey,
          maxTokens: MAX_OUTPUT_TOKENS,
          ...(baseUrl === null ? {} : { configuration: { baseURL: baseUrl } }),
        });

  /** Turns a model-access rejection into a message naming the way out of it. */
  function explain(error: unknown): unknown {
    if (isModelAccessError(error)) {
      return new Error(
        `Provider "${provider}" rejected model "${modelId}" for the ${role} role — ` +
          `the credential may not have access to it. ` +
          `Name another with --model, or set ${modelEnvVar(role)}.`,
        { cause: error },
      );
    }
    return error;
  }

  return {
    modelId,
    cacheable(text) {
      // Marked by hand on this block, rather than through the adapter's
      // top-level `cache_control` option. That option, by its own
      // documentation, "applies a cache breakpoint to the last cacheable block"
      // — which here is the task, the one part that differs every call. It
      // would write an entry per task and read none, at the write premium.
      //
      // Every other provider reaches the OpenAI-compatible adapter, which
      // caches long prefixes on its own and has no breakpoint to place. Sending
      // this block shape there would only risk an argument it does not know.
      //
      // With the cache off the same text goes out as an ordinary block, which
      // is how a run with no cached prefix can be priced against one with it.
      return provider === "anthropic" && promptCache
        ? new HumanMessage({
            content: [{ type: "text", text, cache_control: { type: "ephemeral" } }],
          })
        : ["human", text];
    },
    async invoke(node, messages) {
      try {
        const message = await chat.invoke(messages);
        return {
          text: message.text,
          usage: toUsageEntry({ node, role, model: modelId, usage: message.usage_metadata }),
        };
      } catch (error) {
        throw explain(error);
      }
    },
    async invokeStructured(node, messages, schema) {
      const structured = chat.withStructuredOutput<Record<string, unknown>>(schema, {
        method: "jsonSchema",
        includeRaw: true,
        // Added rather than toggled: the native adapter throws outright when
        // `strict` is present alongside this method, and only the OpenAI one
        // honours it. Verified against the installed adapters, not assumed.
        ...(provider === "openai" ? { strict: true } : {}),
      });

      try {
        const { raw, parsed } = await structured.invoke(messages);
        return {
          value: parsed,
          usage: toUsageEntry({
            node,
            role,
            model: modelId,
            usage: isAIMessage(raw) ? raw.usage_metadata : undefined,
          }),
        };
      } catch (error) {
        throw explain(error);
      }
    },
  };
}

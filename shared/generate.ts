/**
 * Claude API で1レベル分の補足を作る（Worker と Node のスクリプトで共用）。
 *
 * 1. レベル別の指示で生成（構造化出力で JSON を保証）
 * 2. validate.ts で検証（根拠の引用の照合・やさしい日本語のチェック）
 * 3. 基準から外れたものがあれば、1回だけ書き直しを依頼する（フック）
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  NOTES_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildLevelInstruction,
  buildPageBlock,
  buildRepairInstruction,
} from "./prompts.ts";
import type { GeneratorInfo, Level, Note, PageText } from "./types.ts";
import { styleProblems, validateNotes, type DroppedNote } from "./validate.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface GenerateOptions {
  model: string;
  effort: Effort;
  /** 書き直しの依頼をするか（既定: する） */
  repair?: boolean;
}

export interface GenerateResult {
  notes: Note[];
  dropped: DroppedNote[];
  generator: GeneratorInfo;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    requests: number;
  };
}

export class GenerationError extends Error {
  readonly code: "refusal" | "max_tokens" | "invalid_json";
  constructor(message: string, code: GenerationError["code"]) {
    super(message);
    this.code = code;
  }
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function checkStop(message: Anthropic.Beta.BetaMessage): void {
  if (message.stop_reason === "refusal") {
    throw new GenerationError(
      `Claude が生成を断りました（${message.stop_details?.category ?? "理由不明"}）`,
      "refusal",
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new GenerationError("出力が長すぎて途中で切れました", "max_tokens");
  }
}

function parseJson(message: Anthropic.Beta.BetaMessage): unknown {
  try {
    return JSON.parse(textOf(message));
  } catch {
    throw new GenerationError("JSON として読めない出力でした", "invalid_json");
  }
}

export async function generateNotes(
  client: Anthropic,
  page: PageText,
  level: Level,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: 0,
  };
  const addUsage = (m: Anthropic.Beta.BetaMessage) => {
    usage.requests++;
    usage.inputTokens += m.usage.input_tokens;
    usage.outputTokens += m.usage.output_tokens;
    usage.cacheReadTokens += m.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += m.usage.cache_creation_input_tokens ?? 0;
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        // ページ本文は全レベル共通なのでキャッシュする
        { type: "text", text: buildPageBlock(page), cache_control: { type: "ephemeral" } },
        { type: "text", text: buildLevelInstruction(level) },
      ],
    },
  ];
  const request = {
    model: options.model,
    max_tokens: 32000,
    // 安全分類器が断った場合は、サーバー側で推奨モデルに切り替えて続ける
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: [
      { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
    ],
    output_config: {
      effort: options.effort,
      format: { type: "json_schema" as const, schema: NOTES_SCHEMA },
    },
  };

  const first = await client.beta.messages.stream({ ...request, messages }).finalMessage();
  addUsage(first);
  checkStop(first);
  let { notes, dropped } = validateNotes(parseJson(first), page, level);

  const targets = notes
    .map((n, i) => ({ n, i, problems: styleProblems(n) }))
    .filter((t) => t.problems.length > 0);
  if (options.repair !== false && targets.length > 0) {
    // 会話は追記だけで続ける（thinking ブロックを含む応答をそのまま返す）
    const repairMessages: Anthropic.Beta.BetaMessageParam[] = [
      ...messages,
      { role: "assistant", content: first.content },
      {
        role: "user",
        content: buildRepairInstruction(
          targets.map(({ n, problems }) => ({
            sentenceId: n.sentenceId,
            anchor: n.anchor,
            text: n.text,
            detail: n.detail,
            problems,
          })),
        ),
      },
    ];
    try {
      const second = await client.beta.messages
        .stream({ ...request, messages: repairMessages })
        .finalMessage();
      addUsage(second);
      checkStop(second);
      const repaired = validateNotes(parseJson(second), page, level, `L${level}r`).notes;
      targets.forEach((t, k) => {
        const r = repaired[k];
        // 同じ文への補足で、問題が減ったときだけ差し替える
        if (r && r.sentenceId === t.n.sentenceId && styleProblems(r).length < t.problems.length) {
          notes[t.i] = { ...r, id: t.n.id };
        }
      });
    } catch (e) {
      // 書き直しに失敗しても、最初の結果（issues つき）は使える
      dropped = [...dropped, { reason: `書き直しに失敗: ${(e as Error).message}`, raw: null }];
    }
  }

  return {
    notes,
    dropped,
    generator: { kind: "claude-api", model: first.model, promptVersion: PROMPT_VERSION },
    usage,
  };
}

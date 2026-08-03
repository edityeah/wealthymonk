/**
 * OpenAI client + thin helpers shared by the agent (generation, QA, vision).
 *
 * Centralised so the whole agent talks to one provider/model config. Written
 * defensively for the GPT-5.6 reasoning-model family:
 *   - uses `max_completion_tokens` (not `max_tokens`)
 *   - does NOT send a custom `temperature` (these models only accept default)
 *   - budgets tokens generously (hidden reasoning tokens count against the cap)
 *   - `reasoning_effort` only sent when AGENT_REASONING_EFFORT is set
 *
 * Models (override via env):
 *   AGENT_MODEL         report writing  → gpt-5.6-sol   (flagship)
 *   AGENT_QA_MODEL      QA check        → gpt-5.6-luna  (cost-efficient)
 *   AGENT_VISION_MODEL  image selection → gpt-5.6-terra (balanced, multimodal)
 */
import OpenAI from 'openai';

export const MODELS = {
  main: process.env.AGENT_MODEL ?? 'gpt-5.6-sol',
  qa: process.env.AGENT_QA_MODEL ?? 'gpt-5.6-luna',
  vision: process.env.AGENT_VISION_MODEL ?? 'gpt-5.6-terra',
};

// GPT-5.6 defaults to extended reasoning, but Chat-Completions function tools
// require reasoning_effort:'none'. Our tasks (writing grounded in data we already
// supply, plus pick-a-number vision/QA) don't need reasoning, so 'none' is both
// required and appropriate. Override via env if ever needed.
const REASONING = process.env.AGENT_REASONING_EFFORT ?? 'none';

export function hasKey(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

function base(model: string, maxTokens: number): Record<string, unknown> {
  return { model, max_completion_tokens: maxTokens, reasoning_effort: REASONING };
}

type FnTool = { name: string; description: string; parameters: any };

/** Force a function/tool call and return its parsed arguments object. */
export async function toolCall(opts: { system: string; user: string; tool: FnTool; maxTokens: number; model?: string }): Promise<any> {
  const res = await client().chat.completions.create({
    ...base(opts.model ?? MODELS.main, opts.maxTokens),
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    tools: [{ type: 'function', function: opts.tool }],
    tool_choice: { type: 'function', function: { name: opts.tool.name } },
  } as any);
  const call = (res as any).choices?.[0]?.message?.tool_calls?.[0];
  const args = call?.function?.arguments;
  if (!args) throw new Error('OpenAI did not return a function tool call');
  return JSON.parse(args);
}

/** Plain text completion → returns the assistant text. */
export async function textCall(opts: { system: string; user: string; maxTokens: number; model?: string }): Promise<string> {
  const res = await client().chat.completions.create({
    ...base(opts.model ?? MODELS.qa, opts.maxTokens),
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  } as any);
  return (res as any).choices?.[0]?.message?.content ?? '';
}

/** Vision: `content` is an OpenAI content array (text + image_url parts). */
export async function visionCall(opts: { content: any[]; maxTokens: number; model?: string }): Promise<string> {
  const res = await client().chat.completions.create({
    ...base(opts.model ?? MODELS.vision, opts.maxTokens),
    messages: [{ role: 'user', content: opts.content }],
  } as any);
  return (res as any).choices?.[0]?.message?.content ?? '';
}

/** Build an OpenAI image content part from base64 bytes. */
export function imagePart(mediaType: string, dataB64: string): any {
  return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${dataB64}` } };
}
export function textPart(text: string): any {
  return { type: 'text', text };
}

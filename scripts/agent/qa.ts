import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AGENT_QA_MODEL ?? 'claude-sonnet-4-5-20250929';

export interface QaInput { title: string; body: string; sourceSummary?: string; }
export interface QaResult { status: 'Passed' | 'Flagged'; notes: string; }

/** Local, no-LLM checks for the obvious failure modes. Returns issue strings. */
export function deterministicChecks(p: QaInput): string[] {
  const issues: string[] = [];
  if (/\]\(query:/.test(p.body)) issues.push('Unresolved image placeholder (query:) left in body.');
  if (/\]\(\s*\)/.test(p.body)) issues.push('Empty link target in body.');
  if (/!#[^)]*!#/.test(p.body)) issues.push('Placeholder link token (!#…!#) in body.');
  if (/\]\((?:#|javascript:)/i.test(p.body)) issues.push('Suspicious link target in body.');
  if (!p.title || p.title.length < 8) issues.push('Title missing or too short.');
  return issues;
}

/**
 * Full QA: deterministic checks + a cheap LLM judgment on factual
 * self-consistency and whether the title matches the body. Best-effort:
 * if the LLM call fails, fall back to the deterministic result.
 */
export async function runQa(p: QaInput): Promise<QaResult> {
  const det = deterministicChecks(p);

  let llmNotes = '';
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        'You are a publishing QA reviewer. Given a draft title and body, reply with a single line: ' +
        'either "OK" if it is internally consistent, on-topic, and free of obvious factual contradictions, ' +
        'or "FLAG: <short reason>" if not. Be terse.',
      messages: [{ role: 'user', content: `TITLE: ${p.title}\n\nBODY:\n${p.body.slice(0, 6000)}` }],
    });
    const text = res.content.find((c: any) => c.type === 'text') as any;
    const line = (text?.text ?? '').trim();
    if (/^FLAG/i.test(line)) llmNotes = line.replace(/^FLAG:?\s*/i, '');
  } catch (e: any) {
    llmNotes = `QA LLM check skipped: ${e?.message ?? e}`;
  }

  const allIssues = [...det, ...(llmNotes ? [llmNotes] : [])];
  return allIssues.length
    ? { status: 'Flagged', notes: allIssues.join(' | ').slice(0, 1900) }
    : { status: 'Passed', notes: 'No issues found by automated QA.' };
}

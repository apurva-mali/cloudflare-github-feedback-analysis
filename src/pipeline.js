/**
 * Shared analysis + storage pipeline.
 *
 * Both the manual POST /ingest route and the scheduled GitHub sync go through
 * here, so every row in D1 gets the same AI treatment regardless of source.
 */

// @cf/meta/llama-3-8b-instruct (used by the original prototype) was deprecated
// on Workers AI on 2026-05-30. GLM 4.7 Flash is one of Cloudflare's recommended
// replacements. Override with the AI_MODEL var in wrangler.jsonc if needed.
export const DEFAULT_TEXT_MODEL = '@cf/zai-org/glm-4.7-flash';
export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

const MAX_LLM_INPUT_CHARS = 2500;

const SYSTEM_PROMPT = `You are a Product Feedback AI for Cloudflare's developer platform.
Analyze the feedback and return ONLY a JSON object with these keys:

{
  "relevant": true if the text expresses an experience, opinion, complaint, praise or request about a Cloudflare product; false if Cloudflare is only mentioned in passing, as news, or the text is about something else,
  "sentiment_score": integer 1-10 (1 = angry or blocked, 5 = neutral or matter-of-fact, 10 = delighted),
  "urgency_level": "High" | "Neutral" | "Low",
  "user_type": "Enterprise" | "SMB" | "Individual" | "Unknown",
  "product_category": the Cloudflare product it is about, e.g. "Workers", "Wrangler", "Pages", "R2", "D1", "KV", "Durable Objects", "Queues", "Workers AI", "Vectorize", "Zero Trust", or "Unknown",
  "feedback_type": "Bug" | "Feature Request" | "UX" | "Docs" | "Question",
  "summary": at most 20 words, plain English,
  "recommended_action": one short, concrete next step for the product team
}

Guidance:
- A bug report that blocks deploys or production traffic is "High" urgency.
- Polite feature requests and neutral questions are usually "Neutral" urgency and sentiment 5-6.
- Praise ("switched to R2 and our bill dropped", "Workers DX is great") is sentiment 8-10.
- Ignore stack traces and log noise when judging sentiment; judge the human's tone and impact.
No markdown, no prose, JSON only.`;

/**
 * Bucket the 1-10 sentiment score. 5 means neutral, so only clearly negative
 * feedback (1-4) counts against the index. (Classic NPS treats 0-6 as
 * detractors, but that scale is "likelihood to recommend", not mood.)
 */
export function npsFromSentiment(score) {
	if (score >= 8) return 'Promoter';
	if (score >= 5) return 'Passive';
	return 'Detractor';
}

/** Pull the text out of the various Workers AI response shapes. */
export function extractModelText(aiResponse) {
	if (typeof aiResponse === 'string') return aiResponse;
	if (!aiResponse) return '';
	if (typeof aiResponse.response === 'string') return aiResponse.response;
	if (aiResponse.response && typeof aiResponse.response === 'object') return JSON.stringify(aiResponse.response);
	const msg = aiResponse.choices?.[0]?.message;
	if (msg) return msg.content || msg.reasoning_content || '';
	return JSON.stringify(aiResponse);
}

/** Find and parse the first JSON object in model output (tolerates ```json fences and chatter). */
export function parseModelJson(text) {
	const cleaned = String(text).replace(/```(?:json)?/gi, '');
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start === -1 || end <= start) throw new Error('No JSON object in model output');
	return JSON.parse(cleaned.slice(start, end + 1));
}

function clampScore(n) {
	const v = Math.round(Number(n));
	if (!Number.isFinite(v)) return 5;
	return Math.min(10, Math.max(1, v));
}

/**
 * Run the LLM over one piece of feedback.
 * `context` is optional extra text (e.g. repo + labels) that helps the model.
 * Never throws: on failure returns neutral defaults flagged for manual review.
 */
export async function analyzeFeedback(env, text, context = '') {
	const model = env.AI_MODEL || DEFAULT_TEXT_MODEL;
	const userContent = `${context ? context + '\n\n' : ''}Feedback:\n${text.slice(0, MAX_LLM_INPUT_CHARS)}`;
	try {
		const aiResponse = await env.AI.run(model, {
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: userContent },
			],
			max_completion_tokens: 400,
			temperature: 0.2,
			// GLM 4.7 is a reasoning model; we only want the JSON answer.
			chat_template_kwargs: { enable_thinking: false },
		});
		const data = parseModelJson(extractModelText(aiResponse));
		return {
			...data,
			relevant: data.relevant !== false && data.relevant !== 'false',
			sentiment_score: clampScore(data.sentiment_score),
			_ai_ok: true,
		};
	} catch (err) {
		console.error('AI analysis failed, using defaults:', err?.message || err);
		return {
			sentiment_score: 5,
			urgency_level: 'Neutral',
			user_type: 'Unknown',
			product_category: 'Unknown',
			feedback_type: 'UX',
			summary: text.slice(0, 80),
			recommended_action: 'Review manually (AI analysis unavailable)',
			relevant: true, // when unsure, keep it for a human to look at
			_ai_ok: false,
		};
	}
}

const COLUMNS = [
	'id', 'feedback_timestamp', 'user_id', 'source', 'product_category', 'user_type',
	'urgency_level', 'feedback_type', 'region', 'summary', 'recommended_action',
	'feedback_status', 'original_text', 'sentiment_score', 'nps_class',
	'external_id', 'source_url', 'title', 'repo', 'labels', 'source_state',
	'reactions', 'comments_count', 'source_updated_at', 'ingested_at',
];

/**
 * Merge raw item fields with AI output (fields in `overrides` win over the AI)
 * into a full D1 row.
 */
export function buildRecord(item, ai, overrides = {}) {
	const merged = { ...ai, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v != null)) };
	const sentiment = clampScore(merged.sentiment_score);
	return {
		id: crypto.randomUUID(),
		feedback_timestamp: item.timestamp || new Date().toISOString(),
		user_id: item.user_id ?? null,
		source: item.source,
		product_category: merged.product_category || 'Unknown',
		user_type: merged.user_type || 'Unknown',
		urgency_level: merged.urgency_level || 'Neutral',
		feedback_type: merged.feedback_type || 'UX',
		region: item.region ?? null,
		summary: merged.summary || item.text.slice(0, 80),
		recommended_action: merged.recommended_action || 'Review feedback',
		feedback_status: 'Open',
		original_text: item.text,
		sentiment_score: sentiment,
		nps_class: npsFromSentiment(sentiment),
		external_id: item.external_id ?? null,
		source_url: item.source_url ?? null,
		title: item.title ?? null,
		repo: item.repo ?? null,
		labels: item.labels ? JSON.stringify(item.labels) : null,
		source_state: item.source_state ?? null,
		reactions: item.reactions ?? 0,
		comments_count: item.comments_count ?? 0,
		source_updated_at: item.source_updated_at ?? null,
		ingested_at: new Date().toISOString(),
	};
}

/**
 * Store records in D1 (one batch) and Vectorize (one embeddings call + one insert).
 * Batching keeps us well under the per-invocation subrequest limit.
 */
export async function storeRecords(env, records) {
	if (!records.length) return;

	const placeholders = COLUMNS.map(() => '?').join(', ');
	const stmt = env.DB.prepare(
		`INSERT INTO feedback (${COLUMNS.join(', ')}) VALUES (${placeholders})
		 ON CONFLICT(external_id) DO NOTHING`
	);
	await env.DB.batch(records.map((r) => stmt.bind(...COLUMNS.map((c) => r[c]))));

	try {
		const texts = records.map((r) => (r.title ? `${r.title}\n${r.original_text}` : r.original_text).slice(0, 2000));
		const emb = await env.AI.run(EMBEDDING_MODEL, { text: texts });
		await env.VECTOR_INDEX.upsert(
			records.map((r, i) => ({
				id: r.id,
				values: emb.data[i],
				metadata: {
					text: (r.title || r.original_text).slice(0, 100),
					source: r.source,
					product_category: r.product_category,
					urgency_level: r.urgency_level,
				},
			}))
		);
	} catch (err) {
		// D1 is the source of truth; search just won't find these until re-indexed.
		console.error('Vectorize indexing failed (D1 rows kept):', err?.message || err);
	}
}

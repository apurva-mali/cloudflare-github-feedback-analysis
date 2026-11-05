export const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
	});
}

/**
 * Write endpoints (/ingest, /sync/*) require `Authorization: Bearer <ADMIN_TOKEN>`
 * when the ADMIN_TOKEN secret is set. With no secret configured (local dev),
 * they stay open so `wrangler dev` works out of the box.
 */
export function isAuthorized(request, env) {
	if (!env.ADMIN_TOKEN) return true;
	const header = request.headers.get('Authorization') || '';
	return header === `Bearer ${env.ADMIN_TOKEN}`;
}

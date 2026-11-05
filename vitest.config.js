import { defineConfig } from 'vitest/config';

// Unit + pipeline tests run in Node with in-memory fakes for D1, Workers AI,
// Vectorize and the GitHub API (see test/helpers/fakes.js), so they need no
// Cloudflare account or network access.
export default defineConfig({
	test: {
		include: ['test/**/*.spec.js'],
		environment: 'node',
	},
});

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the raw_data.json file
const rawDataPath = join(__dirname, 'raw_data.json');
const rawData = JSON.parse(readFileSync(rawDataPath, 'utf-8'));

// Optional: mix the original synthetic items in alongside real GitHub data.
const INGEST_URL = process.env.INGEST_URL || 'http://localhost:8787/ingest';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DELAY_MS = 2000;

async function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ingestFeedback(item, index, total) {
	try {
		const response = await fetch(INGEST_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
			},
			body: JSON.stringify(item),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		const result = await response.json();
		const textSnippet = item.text.substring(0, 50).replace(/\n/g, ' ');
		const sentimentScore = result.ai_analysis?.sentiment_score || 'N/A';

		console.log(
			`Processing ${index + 1}/${total}: ${textSnippet}... ✅ Success (Sentiment: ${sentimentScore})`
		);

		return result;
	} catch (error) {
		const textSnippet = item.text.substring(0, 50).replace(/\n/g, ' ');
		console.error(
			`Processing ${index + 1}/${total}: ${textSnippet}... ❌ Error: ${error.message}`
		);
		throw error;
	}
}

async function loadAllData() {

	// Defined distribution: 
	// 20 items: 0-20 days ago
	// 30 items: 20-30 days ago
	// Rest (approx 20): 31-60 days ago

	const total = rawData.length;
	const now = new Date();

	console.log(`Starting to process ${total} feedback items with custom date distribution...\n`);

	const urgencyLevels = ['High', 'Neutral', 'Low'];

	for (let i = 0; i < total; i++) {
		const item = { ...rawData[i] };

		// Determine time window based on index
		let daysAgo;
		if (i < 20) {
			// First 20 items: 0-20 days ago
			daysAgo = Math.floor(Math.random() * 20);
		} else if (i < 50) {
			// Next 30 items: 20-30 days ago
			daysAgo = 20 + Math.floor(Math.random() * 10);
		} else {
			// Rest: 31-60 days ago
			daysAgo = 31 + Math.floor(Math.random() * 30);
		}

		const dateCallback = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
		item.timestamp = dateCallback.toISOString();

		// Randomize urgency for variety
		item.urgency_level = urgencyLevels[Math.floor(Math.random() * urgencyLevels.length)];

		try {
			await ingestFeedback(item, i, total);
		} catch (err) {
			console.error(`Skipping item ${i} due to error:`, err.message);
		}

		// Delay to prevent overwhelming local dev server
		await delay(500); // 500ms delay between EACH request
	}

	console.log(`\n✅ Completed processing feedback items!`);
}

// Run the script
loadAllData().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});

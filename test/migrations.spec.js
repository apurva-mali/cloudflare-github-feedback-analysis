import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

function columns(db) {
	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
		.all()
		.map((r) => r.name);
	return Object.fromEntries(tables.map((t) => [t, db.prepare(`PRAGMA table_info(${t})`).all().map((c) => `${c.name}:${c.type}`).sort()]));
}

describe('migrations', () => {
	it('upgrading the first deployed schema gives exactly schema.sql', () => {
		const upgraded = new DatabaseSync(':memory:');
		upgraded.exec(readFileSync(root('test/fixtures/schema_v1.sql'), 'utf8'));
		for (const f of readdirSync(root('migrations')).sort()) upgraded.exec(readFileSync(root(`migrations/${f}`), 'utf8'));

		const fresh = new DatabaseSync(':memory:');
		fresh.exec(readFileSync(root('schema.sql'), 'utf8'));

		expect(columns(upgraded)).toEqual(columns(fresh));
	});

	it('0001 and 0002 can run twice (they were first applied by hand)', () => {
		const db = new DatabaseSync(':memory:');
		db.exec(readFileSync(root('test/fixtures/schema_v1.sql'), 'utf8'));
		for (const f of ['0001_hackernews_and_scoring.sql', '0002_tickets.sql']) {
			db.exec(readFileSync(root(`migrations/${f}`), 'utf8'));
			db.exec(readFileSync(root(`migrations/${f}`), 'utf8'));
		}
		expect(columns(db).tickets).toBeDefined();
	});
});

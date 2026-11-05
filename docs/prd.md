# Project: Cloudflare RAG Feedback Dashboard
We are building a serverless backend on Cloudflare Workers that ingests unstructured product feedback, vectorizes it, and allows for semantic search.

## Infrastructure Bindings (already set in wrangler.jsonc)
- **AI Model:** Binding name `AI`
- **Vector Database:** Binding name `VECTOR_INDEX` (Index name: `feedback-index`)
- **SQL Database:** Binding name `DB` (Database: `feedback-db`)

## Database Schema (Table: 'feedback')
- `id` (TEXT, Primary Key)
- `text` (TEXT)
- `source` (TEXT) - e.g., "Twitter", "Email"
- `created_at` (TIMESTAMP)

## API Requirements

### 1. POST /ingest
- **Input:** JSON `{ "text": "string", "source": "string" }`
- **Logic:**
  1. Generate a UUID.
  2. Use Workers AI (`@cf/baai/bge-base-en-v1.5`) to generate embeddings for `text`.
  3. Insert the raw text and metadata into D1 (`INSERT INTO feedback...`).
  4. Insert the embedding and UUID into Vectorize (`VECTOR_INDEX.insert()`).
- **Response:** 201 Created

### 2. GET /search
- **Input:** Query param `?q=search term`
- **Logic:**
  1. Generate embeddings for the search term using the same AI model.
  2. Query `VECTOR_INDEX` for the top 5 closest vectors.
  3. Use the returned IDs to fetch the full text details from D1 (`SELECT * FROM feedback WHERE id IN (...)`).
  4. Return the combined JSON result.

## Tech Constraints
- Use ES Modules syntax (`export default { async fetch... }`).
- Use `crypto.randomUUID()` for ID generation.
- Ensure error handling for missing inputs.
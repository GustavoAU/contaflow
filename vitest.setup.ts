// vitest.setup.ts — Node 22+ built-in, no dotenv needed
try { process.loadEnvFile(".env"); } catch { /* .env optional in CI */ }

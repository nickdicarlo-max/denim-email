/**
 * Integration test setup — loads .env.local so Prisma, Supabase, and AI clients
 * can read their connection strings / API keys.
 */
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(__dirname, "../../../.env.local") });

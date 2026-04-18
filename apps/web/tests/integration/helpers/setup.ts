/**
 * Integration test setup — loads .env.local so Prisma, Supabase, and AI clients
 * can read their connection strings / API keys.
 */

import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../../.env.local") });

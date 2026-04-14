import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env from repo root so db scripts work without shell-exported env vars
config({ path: "../../.env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env at repo root.");
}

export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

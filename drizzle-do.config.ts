import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/do",
  schema: "./src/db/do-schema.ts",
  dialect: "sqlite",
});

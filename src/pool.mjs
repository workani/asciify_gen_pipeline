import { OpencodePool } from "./llm.mjs";
import { config } from "./config.mjs";

export const pool = new OpencodePool(config.threads);

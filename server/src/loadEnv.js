import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverDir, "..");

config({ path: path.join(repoRoot, ".env") });
config({ path: path.join(serverDir, ".env"), override: true });

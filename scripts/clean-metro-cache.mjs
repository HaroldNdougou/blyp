import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

for (const dir of [".metro-cache", ".expo"]) {
  try {
    rmSync(join(root, dir), { recursive: true, force: true });
    console.log(`removed ${dir}/`);
  } catch {
    /* ignore */
  }
}

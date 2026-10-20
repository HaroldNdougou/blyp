import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cfg = readFileSync(join(root, "infra", "samconfig.toml"), "utf8");
const overridesMatch = cfg.match(/^parameter_overrides\s*=\s*"(.*)"\s*$/m);
if (!overridesMatch) {
  console.error("sam-deploy: parameter_overrides missing in infra/samconfig.toml");
  process.exit(1);
}

function parseParameterOverrides(raw) {
  const s = raw.replace(/\\"/g, '"');
  const out = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && s[i] === " ") i++;
    if (i >= s.length) break;
    const eq = s.indexOf("=", i);
    if (eq === -1) break;
    const key = s.slice(i, eq);
    i = eq + 1;
    let value;
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      value = s.slice(i + 1, end);
      i = end + 1;
    } else {
      const nextSpace = s.indexOf(" ", i);
      if (nextSpace === -1) {
        value = s.slice(i);
        i = s.length;
      } else {
        value = s.slice(i, nextSpace);
        i = nextSpace;
      }
    }
    out[key] = value;
  }
  return out;
}

const params = parseParameterOverrides(overridesMatch[1]);
const paramsPath = join(root, ".aws-sam", "deploy-params.yaml");
const yamlLines = Object.entries(params).map(([k, v]) => {
  const needsQuote = /[\s:"'#]/.test(v);
  const escaped = v.replace(/'/g, "''");
  return needsQuote ? `${k}: '${escaped}'` : `${k}: ${v}`;
});
writeFileSync(paramsPath, `${yamlLines.join("\n")}\n`);

const args = [
  "deploy",
  "--template-file",
  ".aws-sam/build/template.yaml",
  "--stack-name",
  "blyp-api-dev",
  "--capabilities",
  "CAPABILITY_IAM",
  "--resolve-s3",
  "--region",
  "af-south-1",
  "--no-confirm-changeset",
  "--no-fail-on-empty-changeset",
  "--parameter-overrides",
  "file://.aws-sam/deploy-params.yaml",
];

const result = spawnSync("sam", args, {
  cwd: root,
  shell: true,
  stdio: "inherit",
  windowsHide: true,
});

try {
  unlinkSync(paramsPath);
} catch {
  /* ignore */
}

process.exit(result.status ?? 1);

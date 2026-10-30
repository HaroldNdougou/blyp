import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "_archive")
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

for (const file of walk(root)) {
  if (file.includes(`${path.sep}lib${path.sep}ui${path.sep}blypAlert`)) continue;
  if (file.includes(`${path.sep}scripts${path.sep}migrate-blyp-alert`)) continue;
  let s = fs.readFileSync(file, "utf8");
  if (!s.includes("Alert.alert")) continue;

  s = s.replace(/Alert\.alert/g, "blypAlert");

  if (!s.includes('from "@/lib/ui/blypAlert"')) {
    const rnImport = /import \{([^}]+)\} from "react-native";/;
    const m = s.match(rnImport);
    if (m) {
      const parts = m[1]
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x && x !== "Alert");
      const rnLine =
        parts.length > 0
          ? `import { ${parts.join(", ")} } from "react-native";`
          : "";
      s = s.replace(
        rnImport,
        `import { blypAlert } from "@/lib/ui/blypAlert";\n${rnLine}`,
      );
    } else {
      s = `import { blypAlert } from "@/lib/ui/blypAlert";\n${s}`;
    }
  }

  fs.writeFileSync(file, s);
  console.log(path.relative(root, file));
}

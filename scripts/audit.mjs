import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function exists(p) {
  return fs.existsSync(path.join(ROOT, p));
}

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}

function assert(name, condition, detailsIfFail) {
  if (condition) {
    console.log(`✅ ${name}`);
  } else {
    console.log(`❌ ${name}`);
    if (detailsIfFail) console.log(`   → ${detailsIfFail}`);
    process.exitCode = 1;
  }
}

const gemini = exists("services/geminiService.ts") ? read("services/geminiService.ts") : "";
const viteCfg = exists("vite.config.ts") ? read("vite.config.ts") : "";
const envLocal = exists(".env.local") ? read(".env.local") : "";
const pkg = exists("package.json") ? JSON.parse(read("package.json")) : {};

assert(
  "Vite env uses import.meta.env.VITE_GEMINI_API_KEY",
  gemini.includes("import.meta.env.VITE_GEMINI_API_KEY"),
  "Expected import.meta.env.VITE_GEMINI_API_KEY in services/geminiService.ts"
);

assert(
  "No process.env.API_KEY shim in vite.config.ts",
  !viteCfg.includes("process.env.API_KEY"),
  "Remove define shim. Use VITE_* env vars via import.meta.env"
);

assert(
  ".env.local contains VITE_GEMINI_API_KEY",
  /VITE_GEMINI_API_KEY=/.test(envLocal),
  "Rename env var to VITE_GEMINI_API_KEY"
);

assert(
  "Retrieval service exists",
  exists("services/retrievalService.ts"),
  "Expected services/retrievalService.ts"
);

assert(
  "Google Docs writeback service exists",
  exists("services/googleDocsService.ts") || exists("services/googleDocsService.tsx"),
  "Expected a Google Docs API writeback service"
);

assert(
  "Privacy redaction implemented",
  gemini.toLowerCase().includes("redact") || exists("services/redactionService.ts"),
  "Expected PII redaction layer"
);

assert(
  "3-stage pipeline functions exist",
  gemini.includes("extractFacts") && gemini.includes("scoreMatch") && gemini.includes("rewriteDocs"),
  "Expected extractFacts(), scoreMatch(), rewriteDocs() in geminiService.ts"
);

assert(
  "Model routing exists",
  gemini.includes("selectTier") || gemini.includes("Fast") || gemini.includes("Balanced") || gemini.includes("Deep"),
  "Expected tier routing logic"
);

assert(
  "Vitest installed",
  (pkg.devDependencies && pkg.devDependencies.vitest) || (pkg.dependencies && pkg.dependencies.vitest),
  "Expected vitest in package.json"
);

assert(
  "Golden tests folder exists",
  exists("tests/golden") || exists("__tests__/golden"),
  "Expected tests/golden (or __tests__/golden)"
);

console.log("\nAudit finished.");
if (process.exitCode) {
  console.log("\nFix failures before claiming prompts are 'done'.");
}

import { L0_ARTIFACTS } from "../packages/cli/src/lifecycle/l0";

function deriveKind(source: string): string {
  if (source.includes(".cursor/commands/")) return "command";
  if (source.includes(".cursor/rules/")) return "rule";
  if (source.includes("registry/rules/")) return "rule";
  if (source === ".cursor/hooks.json") return "hook";
  if (source.includes(".cursor/hooks/")) return "hook";
  if (source.includes(".cursor/context/")) return "template";
  if (source.includes(".cursor/scripts/")) return "script";
  if (source.includes("autogit/")) return "documentation";
  return "other";
}

// Curated id overrides, keyed by exact `source`. These exist either because
// raw basename derivation collides/misfires (e.g. an internal dot in the
// basename, or a hand-picked disambiguation suffix) and must be preserved
// verbatim rather than re-derived on every generation.
const ID_OVERRIDES: Record<string, string> = {
  ".cursor/hooks.json": "hooks.json",
  ".cursor/context/config.example.json": "config-example",
  ".cursor/scripts/plan-external-review.sh": "plan-external-review-launcher",
  ".cursor/scripts/run-plan-all-consolidate.sh": "run-plan-all-consolidate-launcher",
  "autogit/gitupdate.md": "git-workflow-spine",
};

function deriveId(source: string): string {
  const override = ID_OVERRIDES[source];
  if (override) return override;
  const basename = source.split("/").pop() || source;
  const dotIdx = basename.lastIndexOf(".");
  return dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
}

const artifacts = L0_ARTIFACTS.map((a) => ({
  kind: deriveKind(a.source),
  id: deriveId(a.source),
  path: a.source,
  layer: "L0",
}));

console.log(JSON.stringify(artifacts));

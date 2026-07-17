import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectManagementTool, ServicesDetection } from "../types.js";
import { fileExists } from "../utils/fs.js";

async function detectProjectManagement(rootDir: string): Promise<ProjectManagementTool[]> {
  const tools: ProjectManagementTool[] = [];

  const mcpConfigPaths = [
    path.join(rootDir, ".cursor", "mcp.json"),
    path.join(rootDir, "mcp.json"),
  ];

  for (const configPath of mcpConfigPaths) {
    if (!(await fileExists(configPath))) continue;
    try {
      const raw = await readFile(configPath, "utf8");
      const lower = raw.toLowerCase();
      if (lower.includes("clickup")) tools.push("clickup");
      if (lower.includes("jira") || lower.includes("atlassian")) tools.push("jira");
      if (lower.includes("linear")) tools.push("linear");
      if (lower.includes("asana")) tools.push("asana");
      if (lower.includes("youtrack")) tools.push("youtrack");
      if (lower.includes("shortcut")) tools.push("shortcut");
    } catch {
      // ignore read errors
    }
  }

  if (await fileExists(path.join(rootDir, ".github", "ISSUE_TEMPLATE"))) {
    tools.push("github-issues");
  }
  if (await fileExists(path.join(rootDir, ".github", "projects"))) {
    tools.push("github-projects");
  }

  return [...new Set(tools)];
}

export async function detectServices(rootDir: string): Promise<ServicesDetection> {
  const hasPrisma = await fileExists(path.join(rootDir, "prisma/schema.prisma"));
  const hasSequelize = await fileExists(path.join(rootDir, "sequelize"));
  const hasDrizzle = await fileExists(path.join(rootDir, "drizzle.config.ts"));
  const hasKnex = await fileExists(path.join(rootDir, "knexfile.ts"));
  const hasTypeorm = await fileExists(path.join(rootDir, "ormconfig.json"));

  const database =
    hasPrisma || hasSequelize || hasDrizzle || hasKnex || hasTypeorm ? "postgresql" : undefined;
  const orm = hasPrisma
    ? "prisma"
    : hasDrizzle
      ? "drizzle"
      : hasSequelize
        ? "sequelize"
        : hasKnex
          ? "knex"
          : hasTypeorm
            ? "typeorm"
            : undefined;

  const projectManagement = await detectProjectManagement(rootDir);

  return {
    database,
    orm,
    projectManagement: projectManagement.length > 0 ? projectManagement : undefined,
  };
}

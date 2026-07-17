import { cancel, confirm, isCancel, multiselect, select, text } from "@clack/prompts";
import type {
  IdeDetection,
  IdeName,
  IdePlan,
  ProjectManagementTool,
  ProjectProfile,
  ScanResult,
} from "../types.js";

function ensureNotCancelled<V>(value: V | symbol): V {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
  return value as V;
}

async function askIdeAndPlan(current: IdeDetection): Promise<IdeDetection> {
  const ide = ensureNotCancelled(
    await select<IdeName>({
      message: "Qual IDE principal?",
      initialValue: current.ide === "unknown" ? undefined : current.ide,
      options: [
        { label: "Cursor", value: "cursor" },
        { label: "VS Code", value: "vscode" },
        { label: "Windsurf", value: "windsurf" },
        { label: "Outro", value: "other" },
      ],
    }),
  );

  const plan = ensureNotCancelled(
    await select<IdePlan>({
      message: "Qual seu plano na IDE?",
      initialValue: current.plan === "default" ? undefined : current.plan,
      options: [
        { label: "Cursor Free", value: "cursor-free" },
        { label: "Cursor Pro / Business", value: "cursor-pro" },
        { label: "VS Code + Copilot Free", value: "vscode-free" },
        { label: "VS Code + Copilot Pro / Business", value: "vscode-pro" },
        { label: "Windsurf", value: "windsurf" },
        { label: "Nao sei / padrao", value: "default" },
      ],
    }),
  );

  return { ide, plan };
}

async function askGitWorkflow(current: ProjectProfile["git"]["workflow"]) {
  return ensureNotCancelled(
    await select<ProjectProfile["git"]["workflow"]>({
      message: "Como e seu workflow de Git?",
      initialValue: current === "unknown" ? undefined : current,
      options: [
        { label: "trunk-based (direto na main)", value: "trunk-based" },
        { label: "feature branch -> PR/MR -> main", value: "feature-pr" },
        { label: "gitflow (develop/release/main)", value: "gitflow" },
        { label: "staging -> producao (staging -> main)", value: "homolog-prod" },
      ],
    }),
  );
}

async function askProjectManagement(
  existing: ProjectManagementTool[] = [],
): Promise<ProjectManagementTool[]> {
  return ensureNotCancelled(
    await multiselect({
      message: "Usa algum sistema de gestao de projeto?",
      initialValues: existing,
      options: [
        { label: "GitHub Issues / Projects", value: "github-issues" },
        { label: "Jira", value: "jira" },
        { label: "Linear", value: "linear" },
        { label: "ClickUp", value: "clickup" },
        { label: "Azure Boards", value: "azure-boards" },
        { label: "Asana", value: "asana" },
        { label: "Trello", value: "trello" },
        { label: "Shortcut", value: "shortcut" },
        { label: "Notion", value: "notion" },
        { label: "YouTrack", value: "youtrack" },
      ],
      required: false,
    }),
  ) as ProjectManagementTool[];
}

export async function runExistingProjectWizard(scan: ScanResult): Promise<ProjectProfile> {
  const ide = await askIdeAndPlan(scan.ide);
  const workflow = await askGitWorkflow(scan.git.workflow);
  const projectManagement = await askProjectManagement(scan.services.projectManagement ?? []);
  const installHooks = ensureNotCancelled(
    await confirm({
      message: "Instalar git hooks? (pre-commit: secrets + lint)",
      initialValue: true,
    }),
  );

  return {
    rootDir: scan.rootDir,
    stack: scan.stack,
    git: { ...scan.git, workflow },
    ide,
    infra: scan.infra,
    services: {
      ...scan.services,
      projectManagement: projectManagement.length > 0 ? projectManagement : undefined,
    },
    installHooks,
    selectedCoreComponents: [
      "git-workflow",
      "security-review",
      "clean-code",
      "docs-repo",
      "ide-guide",
    ],
  };
}

export async function runGreenfieldWizard(scan: ScanResult): Promise<ProjectProfile> {
  const language = ensureNotCancelled(
    await select<string>({
      message: "Qual vai ser a stack principal?",
      options: [
        { label: "Node.js (JavaScript/TypeScript)", value: "node" },
        { label: "Python", value: "python" },
        { label: "Go", value: "go" },
        { label: "Ruby", value: "ruby" },
        { label: "Java / Kotlin", value: "java" },
        { label: "PHP", value: "php" },
        { label: "Rust", value: "rust" },
        { label: "C# / .NET", value: "dotnet" },
        { label: "Outra", value: "other" },
      ],
    }),
  );

  const framework = ensureNotCancelled(
    await text({
      message: "Framework principal? (ex: nextjs, nestjs, django, rails, spring, none)",
      placeholder: "none",
      initialValue: "none",
      validate(value) {
        return value.trim().length === 0 ? "Informe um framework ou 'none'" : undefined;
      },
    }),
  );

  const database = ensureNotCancelled(
    await select<string>({
      message: "Vai usar banco de dados?",
      options: [
        { label: "PostgreSQL", value: "postgresql" },
        { label: "MySQL", value: "mysql" },
        { label: "MongoDB", value: "mongodb" },
        { label: "SQLite", value: "sqlite" },
        { label: "SQL Server", value: "sqlserver" },
        { label: "Nenhum por enquanto", value: "none" },
      ],
    }),
  );

  const orm = ensureNotCancelled(
    await text({
      message: "ORM / query builder?",
      placeholder: "prisma, drizzle, sequelize, typeorm, none",
      initialValue: "none",
    }),
  );

  const ide = await askIdeAndPlan(scan.ide);
  const workflow = await askGitWorkflow(scan.git.workflow);
  const projectManagement = await askProjectManagement();
  const installHooks = ensureNotCancelled(
    await confirm({
      message: "Instalar git hooks? (pre-commit: secrets + lint)",
      initialValue: true,
    }),
  );

  return {
    rootDir: scan.rootDir,
    stack: {
      language,
      framework: framework === "none" ? undefined : framework,
      hasProjectFiles: false,
    },
    git: {
      ...scan.git,
      workflow,
    },
    ide,
    infra: scan.infra,
    services: {
      database: database === "none" ? undefined : database,
      orm: orm === "none" ? undefined : orm,
      projectManagement: projectManagement.length > 0 ? projectManagement : undefined,
    },
    installHooks,
    selectedCoreComponents: [
      "git-workflow",
      "security-review",
      "clean-code",
      "docs-repo",
      "ide-guide",
    ],
  };
}

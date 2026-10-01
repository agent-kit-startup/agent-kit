import { defineCommand } from "citty";
import { addDogfoodNote, fileDogfoodIssue } from "../lifecycle/dogfood-file.js";
import { logger } from "../utils/logger.js";

export const dogfoodCommand = defineCommand({
  meta: {
    name: "dogfood",
    description:
      "File dogfood findings headlessly: `add` writes the note + Unprocessed index; `file-issue` opens a private or public issue (GitHub/GitLab).",
  },
  subCommands: {
    add: defineCommand({
      meta: {
        name: "add",
        description:
          "Write the dogfood template file and append the Unprocessed index for the detected lane (factory dogfood/, consumer .cursor/dogfood/).",
      },
      args: {
        topic: { type: "positional", description: "Short topic", required: true },
        summary: { type: "string", description: "Observation (hygiene-stripped)" },
        impact: { type: "string", description: "Impact on the kit or operator" },
        tags: { type: "string", description: "Comma-separated lowercase tags" },
        cwd: { type: "string", default: process.cwd() },
      },
      async run({ args }) {
        const result = await addDogfoodNote(String(args.cwd), {
          topic: String(args.topic),
          summary: args.summary as string | undefined,
          impact: args.impact as string | undefined,
          tags: (args.tags as string | undefined)?.split(",").map((tag: string) => tag.trim()),
          source: "agent-kit dogfood add",
        });
        console.log(JSON.stringify(result, null, 2));
        if (result.status !== "filed") process.exitCode = 1;
      },
    }),
    "file-issue": defineCommand({
      meta: {
        name: "file-issue",
        description:
          "File an issue with the [Dogfood] marker. private: own origin (GitLab confidential). public: factory only, needs --approve-public and a clean hygiene strip.",
      },
      args: {
        visibility: { type: "string", description: "private | public", required: true },
        title: { type: "string", required: true },
        body: { type: "string", required: true },
        "approve-public": {
          type: "boolean",
          description: "Operator approved this public issue (Ask provenance recorded in HANDOFF)",
          default: false,
        },
        cwd: { type: "string", default: process.cwd() },
      },
      async run({ args }) {
        if (args.visibility !== "private" && args.visibility !== "public") {
          logger.error("--visibility must be private or public");
          process.exitCode = 1;
          return;
        }
        const result = await fileDogfoodIssue(String(args.cwd), {
          visibility: args.visibility,
          title: String(args.title),
          body: String(args.body),
          approvedPublic: args["approve-public"] === true,
        });
        console.log(JSON.stringify(result, null, 2));
        if (result.status !== "filed") process.exitCode = 1;
      },
    }),
  },
});

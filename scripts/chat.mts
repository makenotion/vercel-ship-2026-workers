#!/usr/bin/env node

import { issueSignedToken, presignUrl, put } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { ToolLoopAgent, type ToolSet } from "ai";
import { createReadStream, readdirSync } from "node:fs";
import { fromJSONSchema, z } from "zod";
import Debug from "debug";

const log = Debug("workers");

process.loadEnvFile(".env");

export const vercelCredentials = {
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  token: process.env.VERCEL_API_TOKEN!,
};

let tools: ToolSet = {};

for (const workerName of readdirSync("./workers")) {
  log(`Deploying ${workerName}...`);

  // Step 1: Upload source code
  const blobKey = await uploadSource(workerName);
  log(`Uploaded ${blobKey}`);

  // Step 2: Create a sandbox
  const sandbox = await createSandbox(blobKey);
  log(`Created sandbox ${sandbox.name}`);

  // Step 3: Extract tool data
  // TIP: Best-effort sandbox stop, but:
  //     - Ensure clean-up in an async job
  const workerTools = await extractTools(sandbox).finally(() => sandbox.delete());
  log(`Extracted tools %o`, workerTools);

  const newTools = Object.fromEntries(
    Object.entries(workerTools).map(([tool, info]) => [
      tool,
      {
        ...info,
        inputSchema: fromJSONSchema(info.inputSchema),
        execute: executeTool(blobKey, tool),
      },
    ]),
  );

  tools = {
    ...tools,
    ...newTools,
  };

  log("Complete");
}

const agent = new ToolLoopAgent({
  model: "openai/gpt-5.4-nano",
  tools,
});

console.log("\nCHAT TRANSCRIPT");
console.log("========================================");

const stream = await agent.stream({
  messages: [{ role: "user", content: process.argv[2] }],
});

let startedText = false;

for await (const part of stream.fullStream) {
  switch (part.type) {
    case "tool-call":
      process.stdout.write(`Tool Call: "${part.toolName}"...`);
      break;
    case "tool-result":
      process.stdout.write("Done!\n");
      break;
    case "tool-error":
      process.stdout.write("Error!\n");
      break;
    case "text-delta":
      if (!startedText) {
        process.stdout.write("\n");
        startedText = true;
      }

      process.stdout.write(part.text);
      break;
  }
}

async function uploadSource(workerName: string) {
  const blobKey = `${workerName}/bundle.tar.gz`;
  const bundleStream = createReadStream(`./workers/${blobKey}`);

  await put(blobKey, bundleStream, {
    access: "private",
    allowOverwrite: true,
  });

  return blobKey;
}

async function createSandbox(blobKey: string) {
  const inTenMinutes = Date.now() + 60 * 1000 * 10;

  const signedToken = await issueSignedToken({
    pathname: blobKey,
    validUntil: inTenMinutes,
    operations: ["get"],
  });

  const signResult = await presignUrl(signedToken, {
    operation: "get",
    pathname: blobKey,
    access: "private",
    validUntil: inTenMinutes,
  });

  // TIP: Use snapshotting! Omitted for brevity in our example.
  const sandbox = await Sandbox.create({
    ...vercelCredentials,
    persistent: false,
    source: {
      type: "tarball",
      url: signResult.presignedUrl,
    },
  });

  return sandbox;
}

async function extractTools(sandbox: Sandbox) {
  const ModuleDefinition = z.record(
    z.string(),
    z.object({
      description: z.string(),
      inputSchema: z.record(z.string(), z.unknown()),
    }),
  );

  // TIP: Be very careful with this output:
  //     - Look for tags! e.g. <__worker_output__>{}</__worker_output__>
  //     - Limit the logs you consume (stream the output)
  //     - Limit the logs you parse
  //     - Verify shape using libraries like Zod
  const command = await sandbox.runCommand("node", [
    "-e",
    `console.log(JSON.stringify(require("./index.js")))`,
  ]);

  const stdout = await command.output("stdout");

  const moduleDefinition = ModuleDefinition.parse(JSON.parse(stdout));

  return moduleDefinition;
}

function executeTool(blobKey: string, toolName: string) {
  return async (input: unknown) => {
    const sandbox = await createSandbox(blobKey);

    // TIP: The same output verification rules apply here.
    // TIP: Write an SDK that ensures that "execute()" returns serializable values
    // TIP: Ensure process exits (users can leave dangling timers)
    const command = await sandbox.runCommand("node", [
      "-e",
      `require("./index.js")["${toolName}"].execute(${JSON.stringify(input)})
        .then(JSON.stringify)
        .then(console.log)
        .then(() => process.exit(0))
        .catch(err => {
          console.error(err)
          process.exit(1)
        })`,
    ]);

    const stdout = await command.output("stdout").finally(() => sandbox.delete());

    return JSON.parse(stdout);
  };
}

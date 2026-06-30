#!/usr/bin/env node

import { issueSignedToken, presignUrl, put } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { ToolLoopAgent, type ToolSet } from "ai";
import { createReadStream, readdirSync } from "node:fs";
import Debug from "debug";

const log = Debug("workers");

process.loadEnvFile(".env");

export const vercelCredentials = {
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  token: process.env.VERCEL_API_TOKEN!,
};

const tools: ToolSet = {};

for (const workerName of readdirSync("./workers")) {
  log(`Deploying ${workerName}...`);

  // Step 1: Upload source code
  const blobKey = await uploadSource(workerName);
  log(`Uploaded ${blobKey}`);

  // Step 2: Create a sandbox
  const sandbox = await createSandbox(blobKey);
  log(`Created sandbox ${sandbox.name}`);

  console.log("3. Extract tool data");
  console.log("4. Create AI SDK tools");
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

#!/usr/bin/env node

import { ToolLoopAgent, type ToolSet } from "ai";
import { readdirSync } from "node:fs";
import Debug from "debug";

const log = Debug("workers");

process.loadEnvFile(".env");

const tools: ToolSet = {};

for (const workerName of readdirSync("./workers")) {
  log(`Deploying ${workerName}...`);

  console.log("1. Upload source code");
  console.log("2. Create a sandbox");
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

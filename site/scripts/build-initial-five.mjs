#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInitialFive,
  createInitialFiveReader,
  writeInitialFiveArtifacts,
} from "../lib/initial-five/index.mjs";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "manifest" || key === "check") {
      args[key] = true;
    } else {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const siteRoot = path.resolve(args.root ?? scriptRoot);

  if (args.out) {
    const manifest = await writeInitialFiveArtifacts({
      siteRoot,
      outputRoot: path.resolve(args.out),
    });
    printJson({ outputRoot: path.resolve(args.out), ...manifest });
    return;
  }

  const reader = args.issue ? createInitialFiveReader({ siteRoot }) : buildInitialFive({ siteRoot });
  if (args.issue) {
    const bundle = reader.getIssue(args.issue);
    if (!bundle) throw new Error(`Unknown initial-five issue: ${args.issue}`);
    printJson(bundle);
    return;
  }

  if (args.check) {
    printJson({
      schemaVersion: reader.manifest.schemaVersion,
      basisDate: reader.manifest.basisDate,
      issueCount: reader.manifest.issueCount,
      articleCount: reader.manifest.articleCount,
      issues: reader.manifest.issues.map((issue) => ({
        issueId: issue.issueId,
        status: issue.status,
        semantic: issue.semantic,
      })),
    });
    return;
  }

  printJson(reader.manifest);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

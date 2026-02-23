#!/usr/bin/env node

import { Command } from "commander";
import { registerAnalyzeCommand } from "./commands/analyze.js";
import { registerMetricsCommand } from "./commands/metrics-cmd.js";
import { registerLogsCommand } from "./commands/logs-cmd.js";
import { registerStatusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("railway-metrics")
  .description(
    "CLI tool to fetch Railway service metrics and logs, and analyze service health with Claude AI"
  )
  .version("1.0.0");

registerAnalyzeCommand(program);
registerMetricsCommand(program);
registerLogsCommand(program);
registerStatusCommand(program);

program.parse();

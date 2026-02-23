import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { getLinkedStatus, verifyAuth, isCliInstalled } from "../services/auth.js";
import { fetchProject, fetchDeployments } from "../services/railway-client.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show the current Railway project, service, and deployment status")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      const spinner = ora();

      try {
        if (!isCliInstalled()) {
          console.error(chalk.red("Railway CLI not found. Install: npm install -g @railway/cli"));
          process.exit(1);
        }

        spinner.start("Verifying authentication...");
        const user = verifyAuth();
        spinner.succeed(`Authenticated as ${chalk.cyan(user)}`);

        spinner.start("Getting project context...");
        const status = getLinkedStatus();

        if (!status.project?.id) {
          spinner.fail("No linked project");
          console.log(chalk.yellow("\nLink a project: railway link"));
          process.exit(1);
        }
        spinner.succeed("Project context loaded");

        spinner.start("Fetching project details...");
        const projectData = await fetchProject(status.project.id);
        spinner.succeed("Project details fetched");

        if (options.json) {
          console.log(JSON.stringify({ status, project: projectData.project }, null, 2));
          return;
        }

        const project = projectData.project;
        console.log(chalk.bold(`\nProject: ${chalk.cyan(project.name)}`));
        console.log(`  ID: ${chalk.dim(project.id)}`);

        if (status.environment) {
          console.log(`  Environment: ${chalk.green(status.environment.name)} (${chalk.dim(status.environment.id)})`);
        }

        console.log(chalk.bold("\nServices:"));
        for (const edge of project.services.edges) {
          const svc = edge.node;
          const isLinked = svc.id === status.service?.id;
          const marker = isLinked ? chalk.green(" <-- linked") : "";
          console.log(`  - ${svc.name} (${chalk.dim(svc.id)})${marker}`);
        }

        console.log(chalk.bold("\nEnvironments:"));
        for (const edge of project.environments.edges) {
          const env = edge.node;
          const isCurrent = env.id === status.environment?.id;
          const marker = isCurrent ? chalk.green(" <-- current") : "";
          console.log(`  - ${env.name} (${chalk.dim(env.id)})${marker}`);
        }

        // Fetch recent deployments for the linked service
        if (status.service?.id && status.environment?.id) {
          spinner.start("Fetching recent deployments...");
          try {
            const deployments = await fetchDeployments(
              status.project.id,
              status.environment.id,
              status.service.id,
              5
            );
            spinner.succeed("Deployments fetched");

            console.log(chalk.bold("\nRecent Deployments:"));
            for (const edge of deployments.deployments.edges) {
              const d = edge.node;
              const statusColor =
                d.status === "SUCCESS"
                  ? chalk.green
                  : d.status === "FAILED" || d.status === "CRASHED"
                    ? chalk.red
                    : chalk.yellow;
              console.log(
                `  - ${chalk.dim(d.id.substring(0, 12))} | ${statusColor(d.status)} | ${d.createdAt}`
              );
            }
          } catch {
            spinner.warn("Could not fetch deployments");
          }
        }

        console.log();
      } catch (err) {
        spinner.fail("Error");
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}

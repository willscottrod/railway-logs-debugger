import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { verifyAuth } from "../services/auth.js";
import { fetchProject, fetchDeployments } from "../services/railway-client.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show the current Railway project, service, and deployment status")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals();
      const projectId: string = globals.projectId;
      const environmentId: string = globals.environmentId;
      const serviceId: string | undefined = globals.serviceId;
      const spinner = ora();

      try {
        spinner.start("Verifying authentication...");
        const authSource = await verifyAuth();
        spinner.succeed(`Authenticated via ${chalk.cyan(authSource)}`);

        spinner.start("Fetching project details...");
        const projectData = await fetchProject(projectId);
        spinner.succeed("Project details fetched");

        if (options.json) {
          console.log(
            JSON.stringify(
              { projectId, environmentId, serviceId, project: projectData.project },
              null,
              2
            )
          );
          return;
        }

        const project = projectData.project;
        console.log(chalk.bold(`\nProject: ${chalk.cyan(project.name)}`));
        console.log(`  ID: ${chalk.dim(project.id)}`);

        console.log(chalk.bold("\nServices:"));
        for (const edge of project.services.edges) {
          const svc = edge.node;
          const isLinked = svc.id === serviceId;
          const marker = isLinked ? chalk.green(" <-- active") : "";
          console.log(`  - ${svc.name} (${chalk.dim(svc.id)})${marker}`);
        }

        console.log(chalk.bold("\nEnvironments:"));
        for (const edge of project.environments.edges) {
          const env = edge.node;
          const isCurrent = env.id === environmentId;
          const marker = isCurrent ? chalk.green(" <-- active") : "";
          console.log(`  - ${env.name} (${chalk.dim(env.id)})${marker}`);
        }

        // Fetch recent deployments for the service
        if (serviceId) {
          spinner.start("Fetching recent deployments...");
          try {
            const deployments = await fetchDeployments(
              projectId,
              environmentId,
              serviceId,
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

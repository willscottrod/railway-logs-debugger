import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import type { RailwayConfig, RailwayStatus } from "../types/railway.js";

const RAILWAY_CONFIG_PATH = join(homedir(), ".railway", "config.json");

/**
 * Get the Railway API token from the CLI config file or RAILWAY_TOKEN env var.
 */
export async function getToken(): Promise<string> {
  // Check environment variable first
  if (process.env.RAILWAY_TOKEN) {
    return process.env.RAILWAY_TOKEN;
  }

  try {
    const configRaw = await readFile(RAILWAY_CONFIG_PATH, "utf-8");
    const config: RailwayConfig = JSON.parse(configRaw);
    const token = config.user?.token;

    if (!token) {
      throw new Error(
        "No Railway token found in config. Run `railway login` to authenticate."
      );
    }

    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "Railway config not found. Install the Railway CLI and run `railway login`.\n" +
          "Install: npm install -g @railway/cli"
      );
    }
    throw err;
  }
}

/**
 * Check if the Railway CLI is installed and accessible.
 */
export function isCliInstalled(): boolean {
  try {
    execSync("which railway", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current linked project/service/environment from `railway status`.
 */
export function getLinkedStatus(): RailwayStatus {
  try {
    const output = execSync("railway status --json", {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return JSON.parse(output);
  } catch {
    throw new Error(
      "No linked Railway project. Run `railway link` to connect to a project."
    );
  }
}

/**
 * Verify the user is authenticated with Railway.
 */
export function verifyAuth(): string {
  try {
    const output = execSync("railway whoami 2>&1", {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return output.trim();
  } catch {
    throw new Error(
      "Not authenticated with Railway. Run `railway login` to authenticate."
    );
  }
}

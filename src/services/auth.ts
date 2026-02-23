import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import type { RailwayConfig } from "../types/railway.js";

const RAILWAY_CONFIG_PATH = join(homedir(), ".railway", "config.json");

/**
 * Get the Railway API token from the RAILWAY_TOKEN env var or CLI config file.
 */
export async function getToken(): Promise<string> {
  if (process.env.RAILWAY_TOKEN) {
    return process.env.RAILWAY_TOKEN;
  }

  try {
    const configRaw = await readFile(RAILWAY_CONFIG_PATH, "utf-8");
    const config: RailwayConfig = JSON.parse(configRaw);
    const token = config.user?.token;

    if (!token) {
      throw new Error(
        "No Railway token found. Set the RAILWAY_TOKEN environment variable."
      );
    }

    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "Railway token not found. Set the RAILWAY_TOKEN environment variable.\n" +
          "You can create a token at https://railway.com/account/tokens"
      );
    }
    throw err;
  }
}

/**
 * Verify authentication by checking that a token is available.
 * Returns the token source description.
 */
export async function verifyAuth(): Promise<string> {
  if (process.env.RAILWAY_TOKEN) {
    return "API token (RAILWAY_TOKEN)";
  }

  try {
    const configRaw = await readFile(RAILWAY_CONFIG_PATH, "utf-8");
    const config: RailwayConfig = JSON.parse(configRaw);
    if (config.user?.token) {
      return "Railway config (~/.railway/config.json)";
    }
  } catch {
    // Fall through
  }

  throw new Error(
    "Not authenticated. Set the RAILWAY_TOKEN environment variable.\n" +
      "Create a token at https://railway.com/account/tokens"
  );
}

/**
 * Check if the Railway CLI is installed (used for optional log fetching).
 */
export function isCliInstalled(): boolean {
  try {
    const cmd = process.platform === "win32" ? "where railway" : "which railway";
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

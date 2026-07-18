import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface DataDirectoryOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
}

export function getDataDirectory(options: DataDirectoryOptions = {}): string {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const configured = environment.VERA_DATA_DIR?.trim();

  if (configured) {
    return resolve(configured);
  }

  if (!homeDirectory) {
    throw new Error("Cannot determine Vera's application-data directory.");
  }

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Vera");
  }

  if (platform === "win32") {
    const appData = environment.APPDATA?.trim();

    if (!appData) {
      throw new Error("APPDATA is required to locate Vera's data directory on Windows.");
    }

    return join(appData, "Vera");
  }

  const xdgDataHome = environment.XDG_DATA_HOME?.trim();
  return xdgDataHome ? join(xdgDataHome, "vera") : join(homeDirectory, ".local", "share", "vera");
}

export function getDatabasePath(options: DataDirectoryOptions = {}): string {
  return join(getDataDirectory(options), "vera.sqlite");
}

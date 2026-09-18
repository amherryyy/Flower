import type {
  CommandInvocation,
  PackageManagerId
} from "./types.js";

export interface PackageManagerAdapter {
  id: PackageManagerId;
  install(projectRoot: string): CommandInvocation;
  runScript(projectRoot: string, script: string): CommandInvocation;
}

function npmInvocation(projectRoot: string, args: string[]): CommandInvocation {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...args],
      cwd: projectRoot
    };
  }
  return { executable: "npm", args, cwd: projectRoot };
}

const npmAdapter: PackageManagerAdapter = {
  id: "npm",
  install(projectRoot) {
    return npmInvocation(projectRoot, ["install"]);
  },
  runScript(projectRoot, script) {
    return npmInvocation(projectRoot, ["run", script]);
  }
};

export function packageManager(id: string): PackageManagerAdapter {
  if (id === "npm") return npmAdapter;
  throw new Error(`Unsupported package manager '${id}'. Supported package managers: npm`);
}

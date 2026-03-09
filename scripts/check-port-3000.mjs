import net from "node:net";
import readline from "node:readline";
import { execSync } from "node:child_process";

const PORT = 3000;

function listListeningPids(port) {
  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return [...new Set(
      output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )];
  } catch {
    return [];
  }
}

function isPortInUseByBindProbe(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        resolve(true);
        return;
      }
      resolve(true);
    });

    server.once("listening", () => {
      server.close(() => resolve(false));
    });

    // Probe default listener binding (IPv6/IPv4) so this catches :: listeners too.
    server.listen(port);
  });
}

async function isPortInUse(port) {
  const listeningPids = listListeningPids(port);
  if (listeningPids.length > 0) {
    return true;
  }
  return isPortInUseByBindProbe(port);
}

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim().toLowerCase());
    });
  });
}

async function main() {
  const inUse = await isPortInUse(PORT);

  if (!inUse) {
    process.exit(0);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `Port ${PORT} is already in use. Free it manually or run 'npm run ports:kill'.`
    );
    process.exit(1);
  }

  let answer = "";
  while (!/^y(es)?$|^n(o)?$/.test(answer)) {
    answer = await promptYesNo(
      `Port ${PORT} is already in use. Kill the process using port ${PORT}? (y/n): `
    );
  }

  if (!/^y(es)?$/.test(answer)) {
    console.error(`Startup cancelled. Port ${PORT} is still in use.`);
    process.exit(1);
  }

  const pids = listListeningPids(PORT);
  if (pids.length === 0) {
    console.error(
      `Port ${PORT} still appears busy, but no listening PID was found. Free it manually and retry.`
    );
    process.exit(1);
  }

  try {
    execSync(`kill -9 ${pids.join(" ")}`, { stdio: "ignore" });
  } catch {
    console.error(
      `Failed to kill the process on port ${PORT}. Free it manually and retry.`
    );
    process.exit(1);
  }

  const released = !(await isPortInUse(PORT));
  if (!released) {
    console.error(
      `Port ${PORT} is still busy after kill attempt. Free it manually and retry.`
    );
    process.exit(1);
  }

  console.log(`Port ${PORT} is now free. Continuing startup.`);
}

await main();

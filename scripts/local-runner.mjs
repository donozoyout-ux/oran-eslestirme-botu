import { accessSync, constants, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const restartDelayMs = 5_000;
let stopping = false;
let child = null;

function isExecutable(file) {
  if (!file) return false;
  try {
    accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function browserCandidates() {
  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES;
    const pfx86 = process.env["PROGRAMFILES(X86)"];
    const local = process.env.LOCALAPPDATA;
    return [
      pf && path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      pfx86 && path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe"),
      local && path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      pf && path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      pfx86 && path.join(pfx86, "Microsoft", "Edge", "Application", "msedge.exe"),
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

function configureBrowser() {
  if (isExecutable(process.env.CHROMIUM_EXECUTABLE_PATH)) return;
  const detected = browserCandidates().find(isExecutable);
  if (detected) {
    process.env.CHROMIUM_EXECUTABLE_PATH = detected;
    console.log(`[local-runner] Tarayici bulundu: ${detected}`);
    return;
  }
  console.warn("[local-runner] Chrome/Edge otomatik bulunamadi. BetExplorer scraper kullaniliyorsa CHROMIUM_EXECUTABLE_PATH ayarla.");
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function runChecked(name, args) {
  const result = spawnSync(command(name), args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} ${args.join(" ")} basarisiz (code=${result.status}).`);
}

function ensureProjectReady() {
  if (!existsSync(path.join(root, ".env"))) {
    console.error("[local-runner] .env bulunamadi. .env.example dosyasini .env olarak kopyalayip Render'daki secret degerlerini yerel .env dosyasina gir.");
    process.exit(1);
  }
  if (!existsSync(path.join(root, "node_modules"))) {
    console.log("[local-runner] node_modules yok; npm ci calistiriliyor...");
    runChecked("npm", ["ci"]);
  }
  console.log("[local-runner] TypeScript build kontrol ediliyor...");
  runChecked("npm", ["run", "build"]);
}

function startBot() {
  if (stopping) return;
  console.log(`[local-runner] Bot baslatiliyor (${new Date().toLocaleString("tr-TR")})...`);
  child = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" },
  });
  child.on("error", (error) => {
    console.error(`[local-runner] Bot baslatma hatasi: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    console.error(`[local-runner] Bot kapandi (code=${code ?? "null"}, signal=${signal ?? "none"}). 5 saniye sonra yeniden baslatiliyor...`);
    setTimeout(startBot, restartDelayMs);
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[local-runner] Kapatiliyor (${signal})...`);
  if (!child) process.exit(0);
  child.once("exit", () => process.exit(0));
  child.kill("SIGTERM");
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  process.chdir(root);
  configureBrowser();
  ensureProjectReady();
  console.log("[local-runner] Panel: http://127.0.0.1:3000");
  console.log("[local-runner] Durdurmak icin Ctrl+C.");
  startBot();
} catch (error) {
  console.error(`[local-runner] Kurulum/baslatma hatasi: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

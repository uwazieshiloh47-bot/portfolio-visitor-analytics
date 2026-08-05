import { spawnSync } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifactRoot = path.join(projectRoot, ".artifacts");
const bundleDirectory = path.join(artifactRoot, "lambda");
const bundlePath = path.join(bundleDirectory, "index.mjs");
const archivePath = path.join(artifactRoot, "portfolio-visitor-api-dev.zip");

await rm(bundleDirectory, { recursive: true, force: true });
await rm(archivePath, { force: true });
await mkdir(bundleDirectory, { recursive: true });

await build({
  absWorkingDir: projectRoot,
  entryPoints: ["src/handlers/visitor.ts"],
  outfile: ".artifacts/lambda/index.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: false,
  minify: false,

  // The AWS SDK is CommonJS internally and calls require("node:https") while
  // loading. Bundled into ESM output, esbuild rewrites those calls to a shim
  // that throws "Dynamic require of ... is not supported", and the function
  // dies during init before the handler runs.
  //
  // Defining a real require from import.meta.url gives that CommonJS code
  // something that works, while the output stays ESM.
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

const archive =
  process.platform === "win32"
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Compress-Archive -LiteralPath $env:VISITOR_BUNDLE_PATH -DestinationPath $env:VISITOR_ARCHIVE_PATH -Force",
        ],
        {
          env: {
            ...process.env,
            VISITOR_BUNDLE_PATH: bundlePath,
            VISITOR_ARCHIVE_PATH: archivePath,
          },
          stdio: "inherit",
        },
      )
    : spawnSync("zip", ["-j", archivePath, bundlePath], {
        stdio: "inherit",
      });

if (archive.error) {
  throw archive.error;
}

if (archive.status !== 0) {
  throw new Error(`Compress-Archive failed with exit code ${archive.status}`);
}

const { size: bundleBytes } = await stat(bundlePath);
const { size: archiveBytes } = await stat(archivePath);

const archiveListing =
  process.platform === "win32"
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead($env:VISITOR_ARCHIVE_PATH).Entries.FullName",
        ],
        {
          env: {
            ...process.env,
            VISITOR_ARCHIVE_PATH: archivePath,
          },
          encoding: "utf8",
        },
      )
    : spawnSync("unzip", ["-Z1", archivePath], {
        encoding: "utf8",
      });

if (archiveListing.error) {
  throw archiveListing.error;
}

if (archiveListing.status !== 0) {
  throw new Error(
    `Could not inspect deployment ZIP (exit code ${archiveListing.status}).`,
  );
}

const archiveEntries = archiveListing.stdout
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter(Boolean);

if (
  archiveEntries.length !== 1 ||
  archiveEntries[0]?.replaceAll("\\", "/") !== "index.mjs"
) {
  throw new Error(
    `Deployment ZIP must contain only root-level index.mjs; found: ${archiveEntries.join(", ")}`,
  );
}

console.log(`Lambda bundle: ${bundlePath} (${bundleBytes} bytes)`);
console.log(`Deployment ZIP: ${archivePath} (${archiveBytes} bytes)`);
console.log("Verified deployment ZIP entry: index.mjs");

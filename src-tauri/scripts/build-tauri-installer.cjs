const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tauriRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(tauriRoot, "..");
const { detectWebCompanion } = require(path.join(repoRoot, "tools/web-companion-path.cjs"));
const { writeChecksums } = require(path.join(repoRoot, "tools/release-checksums.cjs"));
const { writeOnlineSeed } = require(path.join(repoRoot, "tools/online-seed.cjs"));

async function makeIcon(sharp, pngPath, outPath) {
  const sizes = [256, 64, 48, 32, 16];
  const blobs = await Promise.all(
    sizes.map((size) =>
      sharp(pngPath)
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  blobs.forEach((blob, i) => {
    const entry = Buffer.alloc(16);
    const size = sizes[i];
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(blob.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += blob.length;
    entries.push(entry);
  });
  fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...blobs]));
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const version = process.env.CATSTELLA_BUILD_VERSION || pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(version)) {
    throw new Error(`Invalid installer build version: ${version}`);
  }

  const exePath = path.join(tauriRoot, "target/release/catstella-tauri.exe");
  if (!fs.existsSync(exePath)) {
    throw new Error(`Missing release binary: ${exePath}`);
  }

  const iscc = path.join(repoRoot, "tools/vendor/InnoSetup/ISCC.exe");
  if (!fs.existsSync(iscc)) {
    throw new Error(`Missing Inno Setup compiler: ${iscc}`);
  }

  const outDir = path.resolve(
    process.env.CATSTELLA_TAURI_INSTALLER_OUT || path.join(repoRoot, "dist/installers")
  );
  fs.mkdirSync(outDir, { recursive: true });

  const stage = path.join(tauriRoot, `target/installer-stage-${Date.now()}`);
  const pending = fs.mkdtempSync(path.join(outDir, ".pending-"));
  try {
    const iconsDir = path.join(stage, "icons");
    fs.mkdirSync(iconsDir, { recursive: true });

    fs.copyFileSync(exePath, path.join(stage, "Catstella.exe"));
    for (const metaFile of ["LICENSE", "NOTICE.md", "ASSETS.md"]) {
      const src = path.join(repoRoot, metaFile);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(stage, metaFile));
      }
    }

    const sharp = require("sharp");
    const framesDir = path.join(repoRoot, "Antigravity-Cat-Widget/assets/character-packs/gemini-star-v1/frames");
    await makeIcon(sharp, path.join(framesDir, "idle.png"), path.join(iconsDir, "launch.ico"));
    await makeIcon(sharp, path.join(framesDir, "proud-v3.png"), path.join(iconsDir, "settings.ico"));
    await makeIcon(sharp, path.join(framesDir, "sad-v3.png"), path.join(iconsDir, "uninstall.ico"));

    const bundleOfflineWebExt = process.argv.includes("--bundle-webext");
    const guideSrc = path.join(repoRoot, "tools/installer/web-plugin-guide.html");
    if (fs.existsSync(guideSrc)) {
      fs.copyFileSync(guideSrc, path.join(stage, "web-plugin-guide.html"));
    }
    const skipWebExt = !bundleOfflineWebExt || process.argv.includes("--no-webext");
    const web = skipWebExt ? null : detectWebCompanion({ root: repoRoot });
    let includeWebExt = "0";
    let webDist = stage;

    if (web) {
      const seedDir = path.join(stage, "online-seed");
      webDist = path.join(stage, "web-dist");
      writeOnlineSeed(path.join(repoRoot, "online-assets"), seedDir);
      execFileSync(process.execPath, [path.join(web.base, "scripts/build.js")], {
        stdio: process.argv.includes("--json") ? "pipe" : "inherit",
        cwd: web.base,
        timeout: 300000,
        env: {
          ...process.env,
          CATSTELLA_ONLINE_SEED: seedDir,
          CATSTELLA_WEB_DIST: webDist
        }
      });
      if (
        fs.existsSync(guideSrc) &&
        fs.existsSync(path.join(webDist, "kimino-gemini-companion.xpi")) &&
        fs.existsSync(path.join(webDist, "kimino-gemini-companion-edge-chrome.zip"))
      ) {
        includeWebExt = "1";
      }
    }

    const fileName = `Catstella-Setup-${version}-x64.exe`;
    const target = path.join(outDir, fileName);
    const stagedExe = path.join(pending, fileName);
    const setupIcon = path.join(repoRoot, "Antigravity-Cat-Widget/assets/app-icon.ico");
    const issPath = path.join(tauriRoot, "installer/catstella.iss");

    const isccArgs = [
      `/DAppVersion=${version}`,
      `/DStageDir=${stage}`,
      `/DOutputDir=${pending}`,
      `/DSetupIcon=${setupIcon}`,
      `/DIncludeWebExt=${includeWebExt}`,
      `/DWebExtFiles=${webDist}`,
      issPath
    ];
    execFileSync(iscc, isccArgs, {
      stdio: process.argv.includes("--json") ? "pipe" : "inherit"
    });

    await writeChecksums(stagedExe + ".sha256", [stagedExe]);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    if (fs.existsSync(target + ".sha256")) fs.rmSync(target + ".sha256", { force: true });
    fs.renameSync(stagedExe, target);
    fs.renameSync(stagedExe + ".sha256", target + ".sha256");

    const summary = {
      ok: true,
      version,
      exePath,
      exeBytes: fs.statSync(exePath).size,
      installerPath: target,
      installerBytes: fs.statSync(target).size,
      checksumPath: target + ".sha256",
      webExtIncluded: includeWebExt === "1"
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(pending, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

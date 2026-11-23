const {
  HOST_DEBUG_FLAGS,
  diagnoseHost,
  configureHostShortcuts,
  launchHostWithDebug
} = require("../shared/host.cjs");

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--apply")) {
    const result = await configureHostShortcuts({ enable: true });
    const diag = await diagnoseHost({ bypassCache: true });
    console.log(JSON.stringify({ action: "apply", flags: HOST_DEBUG_FLAGS, result, diagnostic: diag }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (args.has("--restore")) {
    const result = await configureHostShortcuts({ enable: false });
    const diag = await diagnoseHost({ bypassCache: true });
    console.log(JSON.stringify({ action: "restore", result, diagnostic: diag }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (args.has("--launch")) {
    const result = await launchHostWithDebug();
    const diag = await diagnoseHost({ bypassCache: true });
    console.log(JSON.stringify({ action: "launch", result, diagnostic: diag }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const diag = await diagnoseHost({ bypassCache: true });
  console.log(JSON.stringify({ action: "status", flags: HOST_DEBUG_FLAGS, diagnostic: diag }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

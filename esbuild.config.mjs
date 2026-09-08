import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import builtins from "builtin-modules";
import cssModules from "./styles/_manifest.js";

const production = process.argv[2] === "production";

// Obsidian loads a single styles.css; concat the per-feature sources in
// manifest order (split on line boundaries, so join reproduces the original).
const styles = cssModules.map((f) => fs.readFileSync(`styles/${f}`, "utf8")).join("");
fs.writeFileSync("styles.css", styles);

// Drop the three files Obsidian loads into a vault's plugin folder, so a build
// lands where you can reload it. Set VITRINE_VAULT to that folder to enable it.
function installToVault() {
  const dest = process.env.VITRINE_VAULT;
  if (!dest || !fs.existsSync(dest)) return;
  for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(f, `${dest}/${f}`);
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@electron/remote", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
  plugins: [{ name: "install-to-vault", setup: (b) => b.onEnd(installToVault) }],
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}

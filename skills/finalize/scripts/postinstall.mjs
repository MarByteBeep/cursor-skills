#!/usr/bin/env node
/**
 * finalize postinstall — one-time project setup after `npx skills add … --skill finalize`.
 *
 * Usage:
 *   npx skills add MarByteBeep/cursor-skills --skill finalize -a cursor --copy -y && node postinstall.mjs
 *   node postinstall.mjs [repo-root] [options]
 *
 * Options:
 *   --supabase       Include bootstrap (gen types → src/integrations/supabase/types.ts)
 *   --no-supabase    Skip bootstrap step
 *   --caveman        Install caveman skill in this project; pipeline communication: caveman
 *   --no-caveman     Skip caveman install; pipeline communication: brief
 *   -y, --yes        Non-interactive (defaults: supabase if config.toml exists; caveman on)
 *   --dry-run        Print actions without writing or installing
 *   -h, --help
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_DIR = join(__dirname, "..", "templates");
const PIPELINE_PATH = ".agents/skills/finalize/pipeline.json";
/** Vite/React + Supabase template default (repo-relative). */
const DEFAULT_SUPABASE_TYPES_REL = "src/integrations/supabase/types.ts";
const DEV_DEPS = {
	"@biomejs/biome": "latest",
	fallow: "latest",
};
const CAVEMAN_SKILL = "JuliusBrussee/caveman";

function printHelp() {
	console.log(`finalize postinstall — set up finalize for this repo (run once after skills add)

Usage:
  npx skills add MarByteBeep/cursor-skills --skill finalize -a cursor --copy -y && node postinstall.mjs
  node postinstall.mjs [repo-root] [options]

Options:
  --supabase       Include Supabase types bootstrap (writes src/integrations/supabase/types.ts)
  --no-supabase    Skip Supabase bootstrap
  --caveman        Install caveman skill in this project (communication: caveman)
  --no-caveman     Skip caveman; communication: brief
  -y, --yes        Skip prompts (supabase: on if supabase/config.toml exists; caveman: on)
  --dry-run        Show plan only
  -h, --help

After postinstall, /finalize reads ${PIPELINE_PATH} — no detect per run.
`);
}

function parseArgs(argv) {
	/** @type {{ target: string, supabase: boolean | null, caveman: boolean | null, yes: boolean, dryRun: boolean, help: boolean }} */
	const opts = {
		target: process.cwd(),
		supabase: null,
		caveman: null,
		yes: false,
		dryRun: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--supabase") opts.supabase = true;
		else if (a === "--no-supabase") opts.supabase = false;
		else if (a === "--caveman") opts.caveman = true;
		else if (a === "--no-caveman") opts.caveman = false;
		else if (a === "-y" || a === "--yes") opts.yes = true;
		else if (a === "--dry-run") opts.dryRun = true;
		else if (a === "-h" || a === "--help") opts.help = true;
		else if (!a.startsWith("-")) opts.target = resolve(a);
		else die(`unknown flag: ${a}`);
	}
	return opts;
}

function die(msg) {
	console.error(`finalize postinstall: ${msg}`);
	process.exit(1);
}

function isTTY() {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function detectRunner() {
	if (commandExists("bun")) {
		return {
			name: "bun",
			run: (script) => `bun ${script}`,
			exec: (script) => `bunx ${script}`,
			addDevDeps: (deps) => ["add", "-d", ...deps],
			addCmd: "bun",
		};
	}
	return {
		name: "npm",
		run: (script) => `npm run ${script}`,
		exec: (pkg) => `npx ${pkg}`,
		addDevDeps: (deps) => ["install", "-D", ...deps],
		addCmd: "npm",
	};
}

function commandExists(cmd) {
	const r = spawnSync("sh", ["-c", `command -v ${shellEscape(cmd)}`], {
		stdio: "ignore",
	});
	return r.status === 0;
}

function shellEscape(s) {
	return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function detectIndent(raw) {
	if (raw.includes("\n\t")) return "\t";
	return "  ";
}

function readPackageJson(root) {
	const pkgPath = join(root, "package.json");
	if (!existsSync(pkgPath)) die(`no package.json in ${root}`);
	const raw = readFileSync(pkgPath, "utf8");
	return { pkgPath, raw, pkg: JSON.parse(raw), indent: detectIndent(raw) };
}

function hasDep(pkg, name) {
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	return Object.hasOwn(deps, name);
}

function defaultScripts(runner) {
	const x = runner.name === "bun" ? "bunx" : "npx";
	const testCmd = runner.name === "bun" ? "bun test" : "npm test";
	return {
		format: `${x} @biomejs/biome check --write`,
		"check:ci": `${x} @biomejs/biome ci --error-on-warnings && ${x} tsc -b --noEmit && ${testCmd} && rm -f *.tsbuildinfo && echo 'no errors. done'`,
		"check:fallow": `${x} fallow --quiet --format json && ${x} fallow --quiet --fail-on-issues`,
	};
}

function missingScripts(pkg, names) {
	const scripts = pkg.scripts ?? {};
	return names.filter((name) => !(name in scripts));
}

function missingDevDeps(pkg) {
	return Object.keys(DEV_DEPS).filter((name) => !hasDep(pkg, name));
}

async function ask(question, defaultYes) {
	if (!isTTY()) return defaultYes;
	const hint = defaultYes ? "Y/n" : "y/N";
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise((res) => {
		rl.question(`${question} (${hint}) `, res);
	});
	rl.close();
	const t = answer.trim().toLowerCase();
	if (t === "") return defaultYes;
	return t === "y" || t === "yes";
}

function runInstall(runner, deps, dryRun) {
	const args = runner.addDevDeps(deps);
	const cmd = `${runner.addCmd} ${args.join(" ")}`;
	if (dryRun) {
		console.log(`  would run: ${cmd}`);
		return true;
	}
	console.log(`  $ ${cmd}`);
	const r = spawnSync(runner.addCmd, args, { stdio: "inherit", cwd: process.cwd() });
	return r.status === 0;
}

function skillsInvoker(runner) {
	return runner.name === "bun" ? "bunx" : "npx";
}

function installCavemanSkill(runner, dryRun) {
	const inv = skillsInvoker(runner);
	const args = ["skills", "add", CAVEMAN_SKILL, "--skill", "caveman", "-a", "cursor", "--copy", "-y"];
	const cmd = `${inv} ${args.join(" ")}`;
	if (dryRun) {
		console.log(`  would run: ${cmd}`);
		return true;
	}
	console.log(`  $ ${cmd}`);
	const r = spawnSync(inv, args, { stdio: "inherit", cwd: process.cwd() });
	return r.status === 0;
}

function writePackageJson(pkgPath, pkg, indent, dryRun) {
	const next = `${JSON.stringify(pkg, null, indent)}\n`;
	if (dryRun) {
		console.log(`  would update: ${pkgPath}`);
		return;
	}
	writeFileSync(pkgPath, next, "utf8");
	console.log(`  updated: ${pkgPath}`);
}

function hasSupabaseProject(root) {
	return existsSync(join(root, "supabase", "config.toml"));
}

/**
 * Resolve repo-relative path for generated Supabase types.
 * Prefers existing client.ts / types.ts; else Vite template default.
 * Monorepos: first matching apps/.../src/integrations/supabase/client.ts wins.
 */
function detectSupabaseTypesRelPath(root) {
	const defaultRel = DEFAULT_SUPABASE_TYPES_REL;
	if (
		existsSync(join(root, defaultRel)) ||
		existsSync(join(root, "src/integrations/supabase/client.ts"))
	) {
		return defaultRel;
	}

	const appsDir = join(root, "apps");
	if (existsSync(appsDir)) {
		for (const name of readdirSync(appsDir)) {
			const integrationDir = join(appsDir, name, "src/integrations/supabase");
			if (
				existsSync(join(integrationDir, "client.ts")) ||
				existsSync(join(integrationDir, "types.ts"))
			) {
				return join("apps", name, "src/integrations/supabase/types.ts");
			}
		}
	}

	return defaultRel;
}

function supabaseBootstrapCommand(typesRelPath) {
	return `supabase gen types typescript --local --schema public > ${typesRelPath}`;
}

function ensureSupabaseTypesDir(root, typesRelPath, dryRun) {
	const dir = dirname(join(root, typesRelPath));
	if (dryRun) {
		console.log(`  would mkdir -p ${dir}`);
		return;
	}
	mkdirSync(dir, { recursive: true });
}

function loadTemplate(name) {
	const path = join(TEMPLATE_DIR, name);
	if (!existsSync(path)) die(`missing template: ${path}`);
	return readFileSync(path, "utf8");
}

/** @param {string} root @param {string} rel */
function pathExists(root, rel) {
	return existsSync(join(root, rel));
}

/** @param {string} root @returns {string[]} */
function detectFallowEntries(root) {
	/** @type {string[]} */
	const entries = [];
	const addIfExists = (rel) => {
		if (pathExists(root, rel) && !entries.includes(rel)) entries.push(rel);
	};

	for (const rel of ["src/main.tsx", "src/main.ts", "src/index.ts", "index.ts"]) {
		addIfExists(rel);
	}

	for (const scope of ["apps", "packages"]) {
		const scopeDir = join(root, scope);
		if (!existsSync(scopeDir)) continue;
		for (const name of readdirSync(scopeDir)) {
			const relPaths =
				scope === "apps"
					? ["index.ts", "src/main.tsx", "src/main.ts", "src/index.ts"]
					: ["src/index.ts", "index.ts"];
			for (const sub of relPaths) {
				addIfExists(join(scope, name, sub));
			}
		}
	}

	return entries.length > 0 ? entries : ["src/main.tsx"];
}

function prepareFallowrc(root) {
	const template = JSON.parse(loadTemplate(".fallowrc.json"));
	template.entry = detectFallowEntries(root);
	return `${JSON.stringify(template, null, "\t")}\n`;
}

/** @returns {string[]} */
function missingConfigTemplates(root) {
	/** @type {string[]} */
	const missing = [];
	if (!pathExists(root, "biome.json")) missing.push("biome.json");
	if (!pathExists(root, ".fallowrc.json")) missing.push(".fallowrc.json");
	return missing;
}

/** @param {string} root @param {string[]} names @param {boolean} dryRun */
function writeConfigTemplates(root, names, dryRun) {
	for (const name of names) {
		const dest = name;
		const fullPath = join(root, dest);
		const content = name === ".fallowrc.json" ? prepareFallowrc(root) : loadTemplate(name);
		if (dryRun) {
			console.log(`  would write: ${fullPath}`);
			if (name === ".fallowrc.json") {
				console.log(`    entry: ${detectFallowEntries(root).join(", ")}`);
			}
			continue;
		}
		writeFileSync(fullPath, content, "utf8");
		console.log(`  wrote: ${fullPath}`);
		if (name === ".fallowrc.json") {
			console.log(`    entry: ${detectFallowEntries(root).join(", ")}`);
		}
	}
}

function buildPipeline(runner, includeSupabase, scripts, supabaseTypesRel, communication) {
	const loop = [];
	if ("format" in scripts) {
		loop.push({
			phase: "format",
			script: "format",
			command: runner.run("format"),
		});
	}
	if ("check:ci" in scripts) {
		loop.push({
			phase: "ci",
			script: "check:ci",
			command: runner.run("check:ci"),
		});
	}
	if ("check:fallow" in scripts) {
		loop.push({
			phase: "fallow",
			script: "check:fallow",
			command: runner.run("check:fallow"),
			innerLoop: true,
		});
	}

	let bootstrap = null;
	if (includeSupabase && supabaseTypesRel) {
		bootstrap = {
			command: supabaseBootstrapCommand(supabaseTypesRel),
			output: supabaseTypesRel,
			once: true,
		};
	}

	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		packageManager: runner.name,
		scriptsRunner: runner.name === "bun" ? "bunx" : "npx",
		postinstallInvoker: runner.name === "bun" ? "bun" : "node",
		communication,
		bootstrap,
		loop,
	};
}

function writePipeline(root, pipeline, dryRun) {
	const fullPath = join(root, PIPELINE_PATH);
	const dir = dirname(fullPath);
	if (dryRun) {
		console.log(`  would write: ${fullPath}`);
		console.log(JSON.stringify(pipeline, null, 2));
		return;
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, `${JSON.stringify(pipeline, null, "\t")}\n`, "utf8");
	console.log(`  wrote: ${fullPath}`);
}

/** Remove init-only assets from the installed skill copy (scripts + templates). */
function selfDestructSkillAssets(dryRun) {
	const skillDir = join(__dirname, "..");
	const normalized = skillDir.replace(/\\/g, "/");
	if (!normalized.endsWith(".agents/skills/finalize")) {
		return;
	}
	for (const name of ["scripts", "templates"]) {
		const path = join(skillDir, name);
		if (!existsSync(path)) continue;
		if (dryRun) {
			console.log(`  would remove: ${path}`);
			continue;
		}
		rmSync(path, { recursive: true, force: true });
		console.log(`  removed: ${path}`);
	}
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		return;
	}

	const root = opts.target;
	process.chdir(root);

	console.log("finalize postinstall\n");
	console.log(`  repo: ${root}`);

	const runner = detectRunner();
	console.log(`  runner: ${runner.name}${runner.name === "bun" ? "" : " (bun not found)"}\n`);

	const { pkgPath, raw, pkg: initialPkg, indent: initialIndent } = readPackageJson(root);
	let pkg = initialPkg;
	let indent = initialIndent;
	if (!pkg.scripts) pkg.scripts = {};
	if (!pkg.devDependencies) pkg.devDependencies = {};

	const scriptDefaults = defaultScripts(runner);
	const needScripts = missingScripts(pkg, Object.keys(scriptDefaults));
	const needDeps = missingDevDeps(pkg);
	const hasSupabase = hasSupabaseProject(root);
	const hasSupabaseCli = commandExists("supabase");
	const supabaseTypesRel = detectSupabaseTypesRelPath(root);

	let configureStarted = false;
	const startConfigure = () => {
		if (!configureStarted) {
			console.log("Configure pipeline:\n");
			configureStarted = true;
		}
	};

	/** @type {boolean | null} */
	let useCaveman = opts.caveman;
	if (useCaveman === null) {
		if (opts.yes || !isTTY()) {
			useCaveman = true;
		} else {
			startConfigure();
			useCaveman = await ask(
				"? Install caveman skill for terse /finalize status updates?",
				true,
			);
		}
	}
	const communication = useCaveman ? "caveman" : "brief";

	/** @type {boolean | null} */
	let includeSupabase = opts.supabase;
	if (includeSupabase === null) {
		const defaultSupabase = hasSupabase;
		if (opts.yes || !isTTY()) {
			includeSupabase = defaultSupabase;
		} else {
			startConfigure();
			const cmd = supabaseBootstrapCommand(supabaseTypesRel);
			const prompt = hasSupabase
				? `? Include Supabase types step (runs \`${cmd}\` once before loop)?`
				: `? Include Supabase types step (runs \`${cmd}\` once before loop)? (supabase/config.toml not found)`;
			includeSupabase = await ask(prompt, defaultSupabase);
		}
	}
	if (includeSupabase && !hasSupabaseCli) {
		die("Supabase bootstrap requires the supabase CLI on PATH");
	}

	const needConfigTemplates = missingConfigTemplates(root);

	let addDeps = needDeps.length > 0;
	if (addDeps && !opts.yes && isTTY()) {
		console.log("");
		addDeps = await ask(
			`? Add missing devDependencies (${needDeps.join(", ")})?`,
			true,
		);
	} else if (addDeps && opts.yes) {
		addDeps = true;
	}

	let addScripts = needScripts.length > 0;
	if (addScripts && !opts.yes && isTTY()) {
		addScripts = await ask(
			`? Add finalize scripts to package.json (${needScripts.join(", ")})?`,
			true,
		);
	} else if (addScripts && opts.yes) {
		addScripts = true;
	}

	let addConfigTemplates = needConfigTemplates.length > 0;
	if (addConfigTemplates && !opts.yes && isTTY()) {
		addConfigTemplates = await ask(
			`? Add config templates (${needConfigTemplates.join(", ")})?`,
			true,
		);
	} else if (addConfigTemplates && opts.yes) {
		addConfigTemplates = true;
	}

	console.log("\nPlan:\n");

	if (addDeps && needDeps.length > 0) {
		console.log("  devDependencies:");
		for (const name of needDeps) {
			console.log(`    + ${name}@${DEV_DEPS[name]}`);
		}
	}

	if (addScripts && needScripts.length > 0) {
		console.log("  scripts:");
		for (const name of needScripts) {
			console.log(`    + ${name}`);
		}
	}

	if (addConfigTemplates && needConfigTemplates.length > 0) {
		console.log("  config:");
		for (const name of needConfigTemplates) {
			console.log(`    + ${name}`);
		}
		if (needConfigTemplates.includes(".fallowrc.json")) {
			console.log(`      entry: ${detectFallowEntries(root).join(", ")}`);
		}
	}

	console.log(
		`  bootstrap: ${includeSupabase ? supabaseBootstrapCommand(supabaseTypesRel) : "(none)"}`,
	);
	if (includeSupabase) {
		console.log(`  types output: ${supabaseTypesRel}`);
	}
	console.log(`  communication: ${communication}`);
	if (useCaveman) {
		console.log(`  caveman: ${skillsInvoker(runner)} skills add ${CAVEMAN_SKILL} --skill caveman -a cursor --copy -y`);
	}
	console.log("  loop: format → check:ci → check:fallow\n");

	if (addDeps && needDeps.length > 0) {
		const specs = needDeps.map((name) => `${name}@${DEV_DEPS[name]}`);
		if (opts.dryRun) {
			runInstall(runner, specs, true);
		} else {
			const ok = runInstall(runner, specs, false);
			if (!ok) die("failed to install devDependencies");
			({ pkg, indent } = readPackageJson(root));
		}
	}

	if (addScripts && needScripts.length > 0) {
		for (const name of needScripts) {
			pkg.scripts[name] = scriptDefaults[name];
		}
		writePackageJson(pkgPath, pkg, indent, opts.dryRun);
	}

	if (includeSupabase) {
		ensureSupabaseTypesDir(root, supabaseTypesRel, opts.dryRun);
	}

	if (addConfigTemplates && needConfigTemplates.length > 0) {
		writeConfigTemplates(root, needConfigTemplates, opts.dryRun);
	}

	const pipeline = buildPipeline(
		runner,
		includeSupabase,
		pkg.scripts,
		supabaseTypesRel,
		communication,
	);
	if (pipeline.loop.length === 0) {
		die("no loop steps — need format, check:ci, and/or check:fallow scripts");
	}

	writePipeline(root, pipeline, opts.dryRun);

	if (useCaveman) {
		console.log("");
		const ok = installCavemanSkill(runner, opts.dryRun);
		if (!ok && !opts.dryRun) {
			console.warn(
				"  caveman install failed — install manually or re-run postinstall with --no-caveman for brief mode",
			);
		}
	}

	console.log("");
	selfDestructSkillAssets(opts.dryRun);

	console.log("\nDone. Run /finalize in Cursor.\n");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

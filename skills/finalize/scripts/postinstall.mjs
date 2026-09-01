#!/usr/bin/env node
/**
 * finalize postinstall — one-time project setup after `npx skills add … --skill finalize`.
 *
 * Usage:
 *   npx skills add MarByteBeep/cursor-skills --skill finalize -a cursor --copy -y && node postinstall.mjs
 *   node postinstall.mjs [repo-root] [options]
 *
 * Options:
 *   --supabase       Include Supabase type generation in finalize preflight
 *   --no-supabase    Omit Supabase type generation from finalize preflight
 *   --caveman        Install caveman skill in this project; pipeline communication: caveman
 *   --no-caveman     Skip caveman install; pipeline communication: brief
 *   -y, --yes        Non-interactive (defaults: supabase if config.toml exists; caveman on)
 *   --force          Re-run even if pipeline.json exists (requires skill reinstall for templates)
 *   --dry-run        Print plan; no file writes or package installs
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
  --supabase       Include Supabase type generation in finalize preflight
  --no-supabase    Omit Supabase type generation from finalize preflight
  --caveman        Install caveman skill in this project (communication: caveman)
  --no-caveman     Skip caveman; communication: brief
  -y, --yes        Skip prompts (supabase: on if supabase/config.toml exists; caveman: on)
  --force          Re-run even if ${PIPELINE_PATH} exists (reinstall skill first — templates are removed after init)
  --dry-run        Print plan; no file writes or package installs
  -h, --help

After postinstall, /finalize reads ${PIPELINE_PATH} — no detect per run.
`);
}

function parseArgs(argv) {
	/** @type {{ target: string, supabase: boolean | null, caveman: boolean | null, yes: boolean, force: boolean, dryRun: boolean, help: boolean }} */
	const opts = {
		target: process.cwd(),
		supabase: null,
		caveman: null,
		yes: false,
		force: false,
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
		else if (a === "--force") opts.force = true;
		else if (a === "--dry-run") opts.dryRun = true;
		else if (a === "-h" || a === "--help") opts.help = true;
		else if (!a.startsWith("-")) opts.target = resolve(a);
		else die(`unknown flag: ${a}`);
	}
	return opts;
}

/** @returns {never} */
function die(msg) {
	console.error(`finalize postinstall: ${msg}`);
	process.exit(1);
}

function isTTY() {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const FINALIZE_LOOP = ["format", "check:ci", "check:fallow"];

function makeRunner(name) {
	if (name === "bun") {
		return {
			name: "bun",
			run: (script) => `bun run ${script}`,
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

/** Prefer project lockfile / packageManager, then PATH. */
function detectRunner(root, pkg) {
	if (pkg.packageManager !== undefined && typeof pkg.packageManager !== "string") {
		die("package.json packageManager must be a string");
	}
	if (pkg.packageManager) {
		const declared = pkg.packageManager.split("@")[0];
		if (declared !== "bun" && declared !== "npm") {
			die(`unsupported package manager "${declared}" — finalize supports bun and npm`);
		}
		if (!commandExists(declared)) die(`${declared} required by package.json but not on PATH`);
		return makeRunner(declared);
	}
	if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) {
		if (!commandExists("bun")) die("bun.lock present but bun not on PATH");
		return makeRunner("bun");
	}
	if (existsSync(join(root, "package-lock.json"))) {
		if (!commandExists("npm")) die("package-lock.json present but npm not on PATH");
		return makeRunner("npm");
	}
	if (commandExists("bun")) return makeRunner("bun");
	if (commandExists("npm")) return makeRunner("npm");
	die("need bun or npm on PATH");
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

function defaultScripts(runner, includeSupabase, supabaseTypesRel) {
	const x = runner.name === "bun" ? "bunx" : "npx";
	const testCmd = runner.name === "bun" ? "bun test" : "npm test";
	/** @type {Record<string, string>} */
	const scripts = {
		format: `${x} @biomejs/biome check --write`,
		"check:ci": `${x} @biomejs/biome ci --error-on-warnings && ${x} tsc -b --noEmit && ${testCmd} && rm -f *.tsbuildinfo && echo 'no errors. done'`,
		"check:fallow": `${x} fallow --quiet --format json && ${x} fallow --quiet --fail-on-issues`,
	};
	// Keep this as a package script so developers can run it manually:
	//   bun run supabase:types
	// When Supabase is enabled, finalize also runs it automatically via preflight.
	if (includeSupabase) {
		scripts["supabase:types"] = supabaseTypesScript(supabaseTypesRel);
	}
	return scripts;
}


/** Scripts that exist but differ from finalize defaults. */
function scriptConflicts(pkg, scriptDefaults) {
	const scripts = pkg.scripts ?? {};
	return Object.keys(scriptDefaults).filter(
		(name) => name in scripts && scripts[name] !== scriptDefaults[name],
	);
}

/** Scripts missing or mismatched — finalize owns these names. */
function scriptsNeedingWrite(pkg, scriptDefaults) {
	const scripts = pkg.scripts ?? {};
	return Object.keys(scriptDefaults).filter(
		(name) => !(name in scripts) || scripts[name] !== scriptDefaults[name],
	);
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

function supabaseTypesScript(typesRelPath) {
	return `supabase gen types typescript --local --schema public > ${shellEscape(typesRelPath)}`;
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

const FALLOW_RULE_REL = ".cursor/rules/fallow.mdc";

/** @type {Record<string, string>} template filename → repo-relative dest */
const CONFIG_TEMPLATE_DEST = {
	"biome.json": "biome.json",
	".fallowrc.json": ".fallowrc.json",
	"fallow.mdc": FALLOW_RULE_REL,
};

/** @returns {string[]} */
function missingConfigTemplates(root) {
	/** @type {string[]} */
	const missing = [];
	for (const [template, dest] of Object.entries(CONFIG_TEMPLATE_DEST)) {
		if (!pathExists(root, dest)) missing.push(template);
	}
	return missing;
}

function normalizeJson(raw) {
	return JSON.stringify(JSON.parse(raw));
}

/** Compare fallowrc bodies — entry is project-specific and excluded. */
function fallowrcBody(raw) {
	const { entry: _entry, ...rest } = JSON.parse(raw);
	return rest;
}

/** Normalize materialized package manager for fallow.mdc comparison. */
function normalizeFallowMdc(raw) {
	return raw
		.trim()
		.replace(/\b(bun|npm)\b run check:fallow/g, "{{packageManager}} run check:fallow");
}

/** Existing config files that differ from finalize templates (finalize owns these). */
function configContentConflicts(root) {
	/** @type {string[]} */
	const conflicts = [];
	for (const [template, dest] of Object.entries(CONFIG_TEMPLATE_DEST)) {
		if (!pathExists(root, dest)) continue;
		const existing = readFileSync(join(root, dest), "utf8");
		try {
			if (template === "biome.json") {
				if (normalizeJson(existing) !== normalizeJson(loadTemplate(template))) {
					conflicts.push(template);
				}
			} else if (template === ".fallowrc.json") {
				if (
					JSON.stringify(fallowrcBody(existing)) !==
					JSON.stringify(fallowrcBody(loadTemplate(template)))
				) {
					conflicts.push(template);
				}
			} else if (template === "fallow.mdc") {
				if (normalizeFallowMdc(existing) !== normalizeFallowMdc(loadTemplate(template))) {
					conflicts.push(template);
				}
			}
		} catch {
			conflicts.push(template);
		}
	}
	return conflicts;
}

/** @param {string} root @param {string[]} names @param {boolean} dryRun */
function writeConfigTemplates(root, names, dryRun) {
	for (const name of names) {
		const dest = CONFIG_TEMPLATE_DEST[name] ?? name;
		const fullPath = join(root, dest);
		const content = name === ".fallowrc.json" ? prepareFallowrc(root) : loadTemplate(name);
		if (dryRun) {
			console.log(`  would write: ${fullPath}`);
			if (name === ".fallowrc.json") {
				console.log(`    entry: ${detectFallowEntries(root).join(", ")}`);
			}
			continue;
		}
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, content, "utf8");
		console.log(`  wrote: ${fullPath}`);
		if (name === ".fallowrc.json") {
			console.log(`    entry: ${detectFallowEntries(root).join(", ")}`);
		}
	}
}

function buildPipeline(runner, includeSupabase, communication) {
	/** @type {{
	 *   communication: string,
	 *   packageManager: string,
	 *   preflight: string[],
	 *   loop: string[]
	 * }} */
	// preflight[] = package.json script names run before loop[] on every /finalize (may be []).
	return {
		communication,
		packageManager: runner.name,
		preflight: includeSupabase ? ["supabase:types"] : [],
		loop: [...FINALIZE_LOOP],
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

/** Resolve {{#caveman}}…{{/caveman}} / {{#brief}}…{{/brief}} blocks — keep selected mode only. */
function resolveConditionalBlocks(content, mode) {
	return content.replace(
		/\{\{#(caveman|brief)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
		(_, name, body) => (name === mode ? body : ""),
	);
}

function materializeContent(raw, runner, communication) {
	let next = resolveConditionalBlocks(raw, communication);
	next = next.replaceAll("{{packageManager}}", runner.name);
	next = next.replaceAll("{{communication}}", communication);
	return next.replace(/\n{3,}/g, "\n\n");
}

function needsMaterialize(raw) {
	return (
		raw.includes("{{packageManager}}") ||
		raw.includes("{{communication}}") ||
		raw.includes("{{#caveman}}") ||
		raw.includes("{{#brief}}")
	);
}

/** @param {string} filePath @param {ReturnType<typeof detectRunner>} runner @param {string} communication @param {boolean} dryRun */
function materializeFile(filePath, runner, communication, dryRun) {
	if (!existsSync(filePath)) return;
	const raw = readFileSync(filePath, "utf8");
	if (!needsMaterialize(raw)) return;
	const next = materializeContent(raw, runner, communication);
	if (dryRun) {
		console.log(`  would materialize: ${filePath} (${runner.name}, ${communication})`);
		return;
	}
	writeFileSync(filePath, next, "utf8");
	console.log(`  materialized: ${filePath} (${runner.name}, ${communication})`);
}

/** Replace {{placeholders}} in SKILL.md and fallow.mdc after postinstall. */
function materializeProject(root, runner, communication, dryRun) {
	const skillDir = join(__dirname, "..");
	const normalized = skillDir.replace(/\\/g, "/");
	if (normalized.endsWith(".agents/skills/finalize")) {
		materializeFile(join(skillDir, "SKILL.md"), runner, communication, dryRun);
	}
	materializeFile(join(root, FALLOW_RULE_REL), runner, communication, dryRun);
}

/** Fail fast when postinstall assets or pipeline state make a re-run impossible. */
function guardPostinstallState(root, opts) {
	if (!existsSync(TEMPLATE_DIR)) {
		die(
			"postinstall templates missing — reinstall finalize skill (skills add … --skill finalize) before re-running",
		);
	}
	if (pathExists(root, PIPELINE_PATH) && !opts.force) {
		die(
			`${PIPELINE_PATH} already exists — postinstall is one-time; reinstall skill and use --force to replace`,
		);
	}
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
	guardPostinstallState(root, opts);

	console.log("finalize postinstall\n");
	console.log(`  repo: ${root}`);

	const { pkgPath, raw, pkg: initialPkg, indent: initialIndent } = readPackageJson(root);
	let pkg = initialPkg;
	let indent = initialIndent;
	if (!pkg.scripts) pkg.scripts = {};
	if (!pkg.devDependencies) pkg.devDependencies = {};

	const runner = detectRunner(root, pkg);
	console.log(`  runner: ${runner.name}\n`);

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
			const prompt = hasSupabase
				? `? Include supabase:types preflight (adds supabase:types → ${supabaseTypesRel})?`
				: `? Include supabase:types preflight (adds supabase:types → ${supabaseTypesRel}; supabase/config.toml not found)?`;
			includeSupabase = await ask(prompt, defaultSupabase);
		}
	}
	if (includeSupabase && !hasSupabaseCli) {
		die("supabase:types preflight requires the supabase CLI on PATH");
	}

	const scriptDefaults = defaultScripts(runner, includeSupabase, supabaseTypesRel);
	const conflicts = scriptConflicts(pkg, scriptDefaults);
	const scriptsToWrite = scriptsNeedingWrite(pkg, scriptDefaults);

	const needConfigTemplates = missingConfigTemplates(root);
	const configConflicts = configContentConflicts(root);

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

	let applyScripts = scriptsToWrite.length > 0;
	if (conflicts.length > 0) {
		if (opts.yes) {
			applyScripts = true;
		} else if (isTTY()) {
			console.log("");
			applyScripts = await ask(
				`? Overwrite conflicting finalize scripts (${conflicts.join(", ")})?`,
				true,
			);
		} else {
			die(
				`conflicting finalize scripts: ${conflicts.join(", ")} — use -y to overwrite or rename them`,
			);
		}
	} else if (applyScripts && !opts.yes && isTTY()) {
		applyScripts = await ask(
			`? Add finalize scripts to package.json (${scriptsToWrite.join(", ")})?`,
			true,
		);
	} else if (applyScripts && opts.yes) {
		applyScripts = true;
	}

	let overwriteConfig = configConflicts.length > 0;
	if (configConflicts.length > 0) {
		if (opts.yes) {
			overwriteConfig = true;
		} else if (isTTY()) {
			console.log("");
			overwriteConfig = await ask(
				`? Overwrite conflicting finalize config (${configConflicts.join(", ")})?`,
				true,
			);
		} else {
			die(
				`conflicting finalize config: ${configConflicts.join(", ")} — use -y to overwrite`,
			);
		}
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

	const configTemplatesToWrite = [
		...(addConfigTemplates ? needConfigTemplates : []),
		...(overwriteConfig ? configConflicts : []),
	];

	if (needDeps.length > 0 && !addDeps) {
		die(
			`missing required devDependencies: ${needDeps.join(", ")} — install them or re-run postinstall with -y`,
		);
	}
	if (needConfigTemplates.length > 0 && !addConfigTemplates) {
		die(
			`required finalize config missing: ${needConfigTemplates.join(", ")} — add templates or re-run postinstall with -y`,
		);
	}
	if (configConflicts.length > 0 && !overwriteConfig) {
		die(
			`conflicting finalize config: ${configConflicts.join(", ")} — overwrite or re-run postinstall with -y`,
		);
	}
	if (scriptsToWrite.length > 0 && !applyScripts) {
		die(
			`required finalize scripts missing or declined: ${scriptsToWrite.join(", ")} — add scripts or re-run postinstall with -y`,
		);
	}

	console.log("\nPlan:\n");

	if (addDeps && needDeps.length > 0) {
		console.log("  devDependencies:");
		for (const name of needDeps) {
			console.log(`    + ${name}@${DEV_DEPS[name]}`);
		}
	}

	if (applyScripts && scriptsToWrite.length > 0) {
		console.log("  scripts:");
		for (const name of scriptsToWrite) {
			console.log(`    ${conflicts.includes(name) ? "~" : "+"} ${name}`);
		}
	}

	if (configTemplatesToWrite.length > 0) {
		console.log("  config:");
		for (const name of configTemplatesToWrite) {
			const marker = configConflicts.includes(name) ? "~" : "+";
			console.log(`    ${marker} ${name}`);
		}
		if (configTemplatesToWrite.includes(".fallowrc.json")) {
			console.log(`      entry: ${detectFallowEntries(root).join(", ")}`);
		}
	}

	const preflightPlan = includeSupabase ? ["supabase:types"] : [];
	console.log(
		`  preflight: ${preflightPlan.length ? preflightPlan.join(" → ") : "(none)"}`,
	);
	console.log(`  communication: ${communication}`);
	if (useCaveman) {
		console.log(`  caveman: ${skillsInvoker(runner)} skills add ${CAVEMAN_SKILL} --skill caveman -a cursor --copy -y`);
	}
	console.log(`  loop: ${FINALIZE_LOOP.join(" → ")}\n`);

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

	if (applyScripts) {
		for (const name of Object.keys(scriptDefaults)) {
			pkg.scripts[name] = scriptDefaults[name];
		}
		writePackageJson(pkgPath, pkg, indent, opts.dryRun);
	}

	for (const name of Object.keys(scriptDefaults)) {
		if (pkg.scripts[name] !== scriptDefaults[name]) {
			die(
				`script "${name}" does not match finalize default — overwrite declined or fix package.json`,
			);
		}
	}

	if (includeSupabase) {
		ensureSupabaseTypesDir(root, supabaseTypesRel, opts.dryRun);
	}

	if (configTemplatesToWrite.length > 0) {
		writeConfigTemplates(root, configTemplatesToWrite, opts.dryRun);
	}

	const pipeline = buildPipeline(runner, includeSupabase, communication);
	writePipeline(root, pipeline, opts.dryRun);
	materializeProject(root, runner, communication, opts.dryRun);

	if (useCaveman) {
		console.log("");
		const ok = installCavemanSkill(runner, opts.dryRun);
		if (!ok && !opts.dryRun) {
			die("caveman install failed — re-run with --no-caveman or install caveman manually");
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

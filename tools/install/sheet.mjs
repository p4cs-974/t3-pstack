// The model sheet. Provider instance IDs differ per machine, not per harness,
// so since 2.0.0-rc.3 there is one sheet per machine, at
// `${XDG_CONFIG_HOME:-~/.config}/t3-pstack/models.md`. Released versions read
// `t3-pstack-models.md` in each config home, so the installer moves that sheet
// to the machine path once and leaves a symlink at each home's old path, or a
// copy where the system refuses a symlink.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { checkSheet, parseSheet } from "../../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { check, tempBeside, writeAtomic } from "./common.mjs";

export const HOME_SHEET = "t3-pstack-models.md";
const SETUP_HINT = "run /t3-pstack:setup-pstack in a T3 thread";

export const sheetPath = (env, home) =>
  join(env.XDG_CONFIG_HOME?.trim() ? resolve(env.XDG_CONFIG_HOME.trim()) : join(home, ".config"), "t3-pstack", "models.md");

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
const sameBytes = (a, b) => readFileSync(a).equals(readFileSync(b));
const resolvesTo = (path, target) => isFile(path) && isFile(target) && realpathSync(path) === realpathSync(target);
const homeSheets = (homes) => homes.map((home) => join(home.dir, HOME_SHEET));

// Windows makes a symlink only in Developer Mode or an elevated shell, and
// fails with EPERM otherwise. There `path` gets a copy of `target`, unless it
// already holds the same bytes, and doctor warns that the copy won't follow
// later edits. Returns what changed.
function link(target, path) {
  const tmp = tempBeside(path);
  try {
    symlinkSync(target, tmp);
  } catch (err) {
    if (err.code !== "EPERM") throw err;
    if (isFile(path) && sameBytes(path, target)) return undefined;
    writeAtomic(path, readFileSync(target), target);
    return "copied";
  }
  renameSync(tmp, path);
  return "linked";
}
const REFUSED = "since this system refused a symlink";

// A sheet a home links to from outside every home, such as one kept in a
// dotfiles repository, is the user's file to keep.
function outsideHomes(path, homes) {
  return homes.every(({ dir }) => {
    const rel = relative(existsSync(dir) ? realpathSync(dir) : resolve(dir), path);
    return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  });
}

export function moveSheet(sheet, homes) {
  const steps = [];
  if (!isFile(sheet)) {
    const found = [...new Set(homeSheets(homes).filter(isFile).map((path) => realpathSync(path)))];
    if (!found.length) return steps;
    if (new Set(found.map((path) => readFileSync(path, "utf8"))).size > 1) return steps;
    mkdirSync(dirname(sheet), { recursive: true });
    const kept = found.find((path) => outsideHomes(path, homes));
    if (kept) {
      steps.push(link(kept, sheet) === "linked" ? `linked the sheet to ${kept}` : `copied the sheet from ${kept}, ${REFUSED}`);
    } else {
      writeAtomic(sheet, readFileSync(found[0]), found[0]);
      steps.push(`moved the sheet from ${found[0]}`);
    }
  }
  // A home sheet that differs from the machine sheet stays, and doctor names
  // it. A link to another file stays too, so that file is never orphaned.
  for (const path of homeSheets(homes)) {
    if (!existsSync(dirname(path)) || resolvesTo(path, sheet)) continue;
    const present = lstatSync(path, { throwIfNoEntry: false });
    if (present && isFile(path) && (present.isSymbolicLink() || !sameBytes(path, sheet))) continue;
    const done = link(sheet, path);
    if (done) steps.push(done === "linked" ? `linked ${path} to it` : `copied it to ${path}, ${REFUSED}`);
  }
  return steps;
}

export function doctorSheet(sheet, homes, { catalog, roles, tiers, retired = [], hint }) {
  const old = homeSheets(homes).filter(isFile);
  if (!isFile(sheet)) {
    const differ = new Set(old.map((path) => readFileSync(path, "utf8"))).size > 1;
    if (old.length) {
      return [
        check(
          "machine sheet",
          false,
          `missing; ${old.join(", ")} ${differ ? "differ, so the installer leaves them" : "not moved yet"}`,
          differ ? `keep one, then ${hint}` : hint,
        ),
      ];
    }
    return [check("machine sheet", false, "none, so every role runs on its skill's defaults", SETUP_HINT, true)];
  }
  const lines = parseSheet(readFileSync(sheet, "utf8"));
  const problems = checkSheet(lines, { roles, defaults: tiers, catalog, retired });
  // A retired line passes, so a released sheet keeps working, and setup-pstack
  // drops it on its next run.
  const stale = [...new Set(lines.map(({ key }) => key).filter((key) => retired.includes(key)))];
  const shadowing = old.filter((path) => !resolvesTo(path, sheet) && !sameBytes(path, sheet));
  const copies = old.filter((path) => !lstatSync(path).isSymbolicLink() && !resolvesTo(path, sheet) && sameBytes(path, sheet));
  return [
    check(
      "machine sheet valid",
      problems.length === 0,
      problems.length
        ? problems.join("; ")
        : catalog
          ? "every line parses and dispatches on the catalog"
          : "every line parses (pass --catalog to check targets)",
      SETUP_HINT,
    ),
    check(
      "home sheets",
      shadowing.length === 0,
      shadowing.length ? `${shadowing.join(", ")} differ from the machine sheet` : "none differ from it",
      `move each aside, then ${hint} to link it`,
    ),
    ...(copies.length
      ? [check("home sheet copies", false, `${copies.join(", ")} copy it and won't follow later edits to it`, `${hint} to link each; on Windows, turn on Developer Mode first`, true)]
      : []),
    ...(stale.length
      ? [check("retired roles", false, `no skill reads ${stale.map((key) => `"${key}"`).join(", ")}`, `${SETUP_HINT}, which drops them`, true)]
      : []),
  ];
}

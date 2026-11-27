import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { hooksFile as antigravityHooksFile } from "../tools/install/antigravity.mjs";
import { sheetCases, writeSheet } from "./session-hook-sheets.mjs";

const pluginRoot = fileURLToPath(new URL("../plugins/pstack/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
const handler = JSON.parse(readFileSync(join(pluginRoot, manifest.hooks), "utf8")).hooks.SessionStart[0].hooks[0];
const mandate = readFileSync(join(pluginRoot, "hooks/session-start-context.md"), "utf8");
const antigravityCommand = JSON.parse(antigravityHooksFile("win32"))["t3-pstack"].SessionStart[0].command;

function runHook({ runtime = "codex", arg, sheet, codexHome, homeSheet, machineSheet, context = mandate, host = "cmd" } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "pstack windows hook "));
  try {
    const plugin = join(fixture, "plugin with spaces");
    const profile = join(fixture, "user profile");
    const sheetRoot = codexHome ? join(fixture, "codex home") : join(profile, ".codex");
    cpSync(join(pluginRoot, "hooks"), join(plugin, "hooks"), { recursive: true });
    for (const [dir, content] of [[join(profile, ".codex"), homeSheet], [sheetRoot, sheet]]) {
      if (content !== undefined) {
        mkdirSync(dir, { recursive: true });
        writeSheet(join(dir, "t3-pstack-models.md"), content);
      }
    }
    if (machineSheet !== undefined) {
      mkdirSync(join(profile, ".config/t3-pstack"), { recursive: true });
      writeSheet(join(profile, ".config/t3-pstack/models.md"), machineSheet);
    }
    const contextPath = join(plugin, "hooks/session-start-context.md");
    if (context === null) rmSync(contextPath);
    else writeFileSync(contextPath, context);
    // Antigravity runs its command in the plugin root with `cmd /c`, and
    // exports PLUGIN_ROOT.
    const antigravity = runtime === "antigravity";
    const command = antigravity ? antigravityCommand : handler.commandWindows.replaceAll("${CLAUDE_PLUGIN_ROOT}", plugin) + (arg ? ` ${arg}` : "");
    const env = {
      SystemRoot: process.env.SystemRoot,
      PATH: join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0"),
      PATHEXT: process.env.PATHEXT,
      USERPROFILE: profile,
      HOME: join(fixture, "other home"),
      [antigravity ? "PLUGIN_ROOT" : "CLAUDE_PLUGIN_ROOT"]: plugin,
      PSExecutionPolicyPreference: "Restricted",
    };
    for (const name of ["TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "ProgramData", "PSModulePath"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    if (codexHome !== undefined) env.CODEX_HOME = codexHome ? sheetRoot : "";
    const executable = host === "cmd" ? process.env.ComSpec ?? "cmd.exe" : "powershell.exe";
    const args = host === "cmd" ? ["/d", "/s", "/c", command] : ["-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")];
    const result = spawnSync(executable, args, {
      cwd: antigravity ? plugin : undefined,
      env,
      encoding: "utf8",
      windowsVerbatimArguments: host === "cmd",
    });
    if (result.error) throw result.error;
    return { status: result.status, out: result.stdout, err: result.stderr };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// CI's Windows job sets this, so a platform check that misfires fails there
// instead of skipping every test.
const required = process.env.PSTACK_REQUIRE_WINDOWS_HOOK === "1";

describe.skipIf(process.platform !== "win32" && !required)("Windows Codex SessionStart hook", () => {
  test("injects the shared context without a sheet or Bash", () => {
    expect(runHook()).toEqual({ status: 0, out: mandate, err: "" });
    const result = runHook({ host: "powershell" });
    expect({ ...result, out: result.out.replaceAll("\r\n", "\n") }).toEqual({ status: 0, out: mandate.replaceAll("\r\n", "\n"), err: "" });
  });

  test("reads USERPROFILE when CODEX_HOME is absent or empty", () => {
    for (const codexHome of [undefined, false]) {
      expect(runHook({ codexHome, sheet: "session hook: off\n" })).toEqual({ status: 0, out: "", err: "" });
    }
  });

  test("CODEX_HOME takes precedence over USERPROFILE", () => {
    expect(runHook({ codexHome: true, sheet: "session hook: off\r\n", homeSheet: "session hook: on\n" })).toEqual({
      status: 0, out: "", err: "",
    });
    expect(runHook({ codexHome: true, sheet: "session hook: on\n", homeSheet: "session hook: off\n" })).toEqual({
      status: 0, out: mandate, err: "",
    });
  });

  test("the machine sheet decides over the Codex home sheet", () => {
    expect(runHook({ machineSheet: "session hook: off\n", sheet: "session hook: on\n" })).toEqual({ status: 0, out: "", err: "" });
    expect(runHook({ machineSheet: "session hook: on\n", sheet: "session hook: off\n" })).toEqual({
      status: 0, out: mandate, err: "",
    });
  });

  for (const { name, sheet, off } of sheetCases) {
    test(`${off ? "injects nothing" : "injects the context"} when the sheet has ${name}`, () => {
      expect(runHook({ sheet })).toEqual({ status: 0, out: off ? "" : mandate, err: "" });
    });
  }

  test("writes UTF-8 context without an added newline", () => {
    const context = "Routing context: 中文 café 🚀";
    expect(runHook({ context })).toEqual({ status: 0, out: context, err: "" });
  });

  test("fails on a runtime it does not know", () => {
    const result = runHook({ arg: "cursor" });
    expect(result.status).not.toBe(0);
    expect(result.out).toBe("");
    expect(result.err).toContain("cursor");
  });

  test("fails when the context cannot be read", () => {
    const result = runHook({ context: null });
    expect(result.status).not.toBe(0);
    expect(result.out).toBe("");
    expect(result.err).not.toBe("");
  });
});

// The bytes session-start.sh writes for Antigravity.
const antigravityReply = (context) => `{"injectSteps":[{"systemMessage":{"systemMessage":${JSON.stringify(context)}}}]}\n`;

describe.skipIf(process.platform !== "win32" && !required)("Windows Antigravity SessionStart hook", () => {
  const run = (options) => runHook({ runtime: "antigravity", ...options });

  test("injects the shared context as session-start.sh does, without a sheet or Bash", () => {
    expect(run()).toEqual({ status: 0, out: antigravityReply(mandate), err: "" });
  });

  test("reads the machine sheet and never the Codex home sheet", () => {
    expect(run({ machineSheet: "session hook: off\n" })).toEqual({ status: 0, out: "{}\n", err: "" });
    for (const codexHome of [undefined, true]) {
      expect(run({ codexHome, sheet: "session hook: off\n" })).toEqual({ status: 0, out: antigravityReply(mandate), err: "" });
    }
  });

  for (const { name, sheet, off } of sheetCases) {
    test(`${off ? "injects nothing" : "injects the context"} when the machine sheet has ${name}`, () => {
      expect(run({ machineSheet: sheet })).toEqual({ status: 0, out: off ? "{}\n" : antigravityReply(mandate), err: "" });
    });
  }

  test("escapes quotes, backslashes, tabs, and line ends, and writes UTF-8", () => {
    const context = 'Routing: "t3-pstack" in C:\\Users\\a b\tcafé 中文 🚀\r\nnext\n';
    expect(run({ context })).toEqual({ status: 0, out: antigravityReply(context), err: "" });
  });
});

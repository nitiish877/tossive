# Tossive — AI coding assistant for VS Code

Ask Tossive a question, request analysis of selected files, or describe an app, website, game, or script to build. Answers and read-only findings appear in the panel; explicit file changes are proposed as diffs, and checks run only when requested.

## What you can do

- **Ask or build.** Questions, extracted values, and read-only file reviews are answered in the Tossive panel by default. Ask explicitly to write or change a selected file to get a proposed diff. Describe an app to build and Tossive plans the architecture, picks a project folder name, and creates its files. Use **Task mode** to always build, **Auto** to route requests by intent, or **Chat only** to answer without changing files.
- **Get a tidy project folder.** A new project goes into its own folder in your workspace (or straight into the workspace if it is empty). Existing files are never overwritten without your approval.
- **Check your project safely.** Click **Run & check** (or just say "run it" / "test it"). Tossive copies the project to a temporary folder and checks syntax, missing files and one short run. If something fails it asks the model to fix the file and re-checks, up to 2 rounds. Nothing runs unless you ask.
- **Click instead of type.** Plans for big projects, file changes, run commands and follow-up ideas all appear as buttons: **Approve & build**, **Allow & apply changes**, **Run**, **Open in browser**, and suggested next steps. Clicking a suggestion continues the work.
- **Find errors, then you decide.** Select a file (or just open it) and ask "find the errors in this file". Tossive lists each problem as `file:line - what is wrong`, prepares the fix and shows it as a before/after view: **red = previous code, green = new code**, with line numbers and the exact changed characters marked. Click **Allow & apply changes** to write it, or **Don't apply** to keep your file as it is. **Undo changes** restores the old code later. Questions like "explain this file" are answered in chat without touching files.
- **Review changes before they land.** Updates to files you selected show the highlighted before/after view and are applied only after you click **Allow & apply changes**. **Undo** restores files Tossive created or changed while they are still untouched.
- **Run commands with one click.** Known-safe setup/run commands (`npm install`, `npm start`, `node app.js`, `python main.py`, …) run in the project terminal on a single click. Anything else asks once. Destructive or piped-to-shell commands are always blocked.
- **Optional cloud sandbox.** Signed-in users can run the setup/run commands in an isolated cloud sandbox for installs and longer runs (needs a backend that provides it; may use account credits and always asks first).

## The safe check — what it is and is not

It runs only when you ask, for projects up to **30 files and 400 KB of source** by default (thousands of lines, not just a few), for at most about **15 seconds** per run, in a temporary folder outside your workspace. It never installs packages, strips your environment variables (so tokens are not passed to the program), caps the output and stops the process after the timeout. It checks JavaScript, Python, JSON and HTML (inline scripts, missing local files). Browser games and pages cannot be played headlessly, so use **Open in browser** for those.

This is a controlled runner, **not an operating-system sandbox**: a program you run could still use the network or touch files your user can reach. Only run code you are comfortable running on your computer. Use the cloud sandbox when you want real isolation.

## Getting started

1. Open the Tossive icon in the Secondary Side Bar (VS Code 1.106 or newer).
2. Ask a question or describe what to build. Use **＋ Add files** to give Tossive existing files to analyze or change.
3. Use the buttons that appear. You get 3 free messages without an account; sign in with your Tejas account for full access.

## Your files and privacy

Tossive sends your prompt and the text of files you explicitly select to its service for model responses. Context is limited to 512 KB, and `.env` files and dependency/build folders are skipped by the file picker. New project files are written to the open workspace; selected existing files change only after you click **Allow & apply changes**. Conversations are stored locally on this computer, cleared automatically after 2 days, and can be restored for 2 more days.

## Settings and commands

- `tossive.backendUrl` — base address of the Tossive/Tejas backend (default `https://tejas_backed.vercel.app`, without `/api`). Change it only if you run your own backend.
- **Tossive: Open Code Assistant** — opens the panel.
- **Tossive: Show Log** — opens the Tossive output channel with diagnostics for the last requests.
- `tossive.check.maxFiles` (default 30), `tossive.check.maxKilobytes` (default 400) and `tossive.check.runSeconds` (default 15) — limits of the safe check.
- **Tossive: Check Backend Connection** — tests the backend and shows the response time. Useful if replies are slow or fail.

## Troubleshooting

- *"Could not finish project" / the plan was not usable:* Tossive first asks the model for a JSON plan, then retries with a plain-text plan. If both fail, the message now quotes what the model actually replied, and **Tossive: Show Log** lists each model call (sizes and timings, plus a short snippet of the reply on failures; your prompts are not logged). If you selected files and the plan fails, Tossive falls back to a normal written answer about those files.

- *Replies are slow:* servers can take a few seconds to wake up. Run **Tossive: Check Backend Connection**. Project builds make several model calls, so they take longer than a chat reply.
- *Cloud sandbox says "not available":* the backend you use does not provide the sandbox endpoint yet; the local safe check still works.

## Development

```
npm install
# press F5 in VS Code to launch the extension host
node test/sandbox.test.js
node test/diff.test.js
npm i --no-save jsdom && node test/e2e.test.js
npx @vscode/vsce package --allow-missing-repository --skip-license
```

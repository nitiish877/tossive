# Changelog

## 0.5.0

- **Find errors, then ask permission.** Asking Tossive to find or fix errors/bugs in the selected (or active) file now lists every problem as `file:line - what is wrong`, prepares the fixed files, and asks "Allow Tossive to apply these changes?" with **Allow & apply changes** and **Don't apply** buttons. Nothing is written before you allow it, and **Undo changes** restores the old code afterwards. Plain questions about a file ("explain this", "extract the URL") still get a normal answer.
- **Highlighted before/after view inside the panel.** Each changed file shows red lines for the previous code and green lines for the new code, with old/new line numbers, three lines of context, and the exact changed characters marked inside each line. It stays visible after you apply the change. **Open diff** still opens the side-by-side comparison in the editor.
- The fixed file now changes only what is needed (everything else is kept line for line), so the before/after view stays small.
- Tasks still create every file and folder automatically; the extension now also sends `outputMode` (`json` for plans, `code` for files and fixes, `plain` for the text fallback) so the backend gives strict formats and a full output budget. This needs the matching backend update.

## 0.4.7

- Fixed "Could not read the project plan" for tasks and the example buttons: if the model does not answer with JSON, Tossive retries with a plain-text plan format (which also survives cut-off replies). If both fail, the message quotes what the model said instead of a vague error.
- Plan failures on selected files now fall back to a normal written answer instead of an error card.
- Removed the extension-capability notes from the planning and file-writing prompts (they stay in chat), and replaced the "smallest first version" instruction with "complete, working code that meets every requirement".
- The safe check is no longer limited to tiny projects: defaults are now 30 files, 400 KB of source and 15 seconds per run, adjustable with `tossive.check.maxFiles`, `tossive.check.maxKilobytes` and `tossive.check.runSeconds`. Plan approval is only asked above 12 files.
- New **Tossive: Show Log** command and output channel for diagnosing model/backend problems (no prompts are logged).

## 0.4.6

- Keep read-only file analysis and extracted values in the chat panel; only route explicit file-change requests through the diff workflow.
- Preserve URL and inline-code output in chat, and make HTTP(S) links clickable.
- Allow file analysis requests through the backend even when file contents contain shell syntax; analysis does not run those commands.

## 0.3.0

Merged the two code lines (the cloud-sandbox version 0.2.5 and the sign-in version 0.2.9) into one extension, fixed the loading/send problems, and added task automation.

**New**
- Task mode (Auto / Task mode / Chat only). Broader detection of build requests (apps, websites, games, tools, scripts) in English and Hinglish.
- Each new project gets its own folder; an empty workspace is used directly.
- Safe check for small projects (≤ 8 files, 60 KB, ~8 s, no installs, no environment secrets), run only on request, with up to 2 automatic model fixes.
- Optional cloud sandbox (from 0.2.4/0.2.5) for signed-in users, now using the shared sign-in token.
- Clickable everywhere: Approve & build for big plans, Accept/Cancel, one-click Run for safe commands, Open project, Open in browser, and suggested next steps (also for normal chat answers).
- The model is told what the extension can do and must not claim code was run unless a result exists.
- Project file picker inside VS Code (searchable multi-select) with a button for the system dialog.
- `tossive.backendUrl` setting and the **Tossive: Check Backend Connection** command.
- The extension icon.

**Fixed**
- Panel stuck on "loading" (a leftover line crashed activation and a webview script had broken escapes).
- `Cannot read properties of undefined (reading 'files')` when sending.
- Network calls now time out with a clear message instead of hanging.
- Removed the visible "Checking your Tejas connection" state; the sign-in token is now verified silently, once.
- The panel's script and styles moved to `media/` (no more escaping bugs).

**Notes**
- The 0.2.5 line used `tejas_backed.vercel.app` (underscore). Underscores are not valid in host names, so this version uses the `tejas-backed.vercel.app` address from the newer line. If your backend lives elsewhere, set `tossive.backendUrl`.

## 0.2.8

- Recheck saved Tejas sign-in when the panel is reopened or refocused; sign out only when the backend confirms revocation.

## 0.2.7

- Native multi-file picker; preserve typed messages when a send is rejected; handle incomplete final stream events.

## 0.2.6

- Limit guest use to three messages and open sign-in after the third message.
- Remove sign-out from the panel; disconnect editors from Tejas settings.

## 0.2.5

- Render headings, bold text, lists and inline code in assistant replies.
- Open sign-in directly when no Tejas browser session exists.
- Run approved setup commands in the project terminal.

## 0.2.4

- Run generated projects in temporary cloud sandboxes after explicit confirmation.
- Secure Tejas account connection for sandbox access; show sandbox command output in the project card.

## 0.2.3

- Non-spinner activity indicator and clear status labels while the assistant works.
- Local conversation history with 2-day auto-clear and restore.

## 0.2.2

- Route selected-file reviews and fixes through the workspace change workflow.
- Diff, Accept, Cancel and Undo for file changes.

## 0.2.1

- Update the chat service connection.

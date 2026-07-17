# Agent Instructions

## Graphify Integration & Codebase Mapping
1. Before starting any complex coding or planning task, they must read `graphify-out/GRAPH_REPORT.md` to understand the codebase layout.
2. You must never manually edit the files inside the `graphify-out/` directory.
3. when user prompts to update graphify automatically run `graphify update .` using the terminal tool to keep the local graph in sync.

## UI Testing Policy
* If a UI component has been modified, **Do NOT launch automated browser agents** or browser-based testing tools (like Puppeteer, Playwright, or Chrome DevTools subagents) under any circumstances unless explicitly commanded.
* only list what changes were made very precisely in short. 

## Code Safety & Feature Isolation
* **Verify Imports:** Always double-check that any new functions you call are explicitly imported at the top of the file. Missing imports cause silent, app-breaking crashes.
* **Isolate New Features:** When adding new features to shared boot paths (like `main.js`), wrap them in `try-catch` blocks. A failure in a new component (e.g. overview dashboard) must NEVER prevent existing core features (e.g. tables, menu) from loading.

## Continuous Learning
* **Document Mistakes:** Every time a mistake is made and the code is subsequently fixed, you MUST document the lesson learned into this `AGENTS.md` file as a new rule so that future agents do not repeat the same mistake.
* **Reconciliation and Duplicate Handling:** When reconciling local offline database state with cloud database state, never use `Array.find()` (which only resolves/deletes the first match) if there can be multiple duplicates of records (e.g. due to seeding vs. sync queue differences). Always use `Array.filter()` to find and clean up all duplicates with mismatched IDs to prevent duplicate accumulation in IndexedDB.

## Git Operations
* **Pushing Commits:** When the user requests to "commit to git" or "push to git", this implicitly means to both commit the changes locally AND push them to the configured remote repository (`git push`). Always push after committing unless explicitly instructed otherwise.

## Code issue document

Please update the project markdown logs to track a new unresolved error. Do not modify the source code files directly.

** Append to `fixme.md`
Add a new markdown block at the end of the file using this exact structure:

### TODO: [Brief Title of Error]
- **File Path:** `[Insert File Path Here]`
- **Lines Involved:** `[Insert Line Numbers Here]`
- **Terminal Error:** `[Insert Error Message Here]`
- **Attempted Solutions:** [Summarize what Gemini 3.5 tried and why it failed]

## Walkthrough
The walkthrough must be short and precise in less than 10 lines. 

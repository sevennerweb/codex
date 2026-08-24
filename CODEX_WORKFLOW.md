# Codex workflow for webapp_travel_schedule

Codex automatically reads the root `AGENTS.md` when you start a new task in this repository. You do not need to invoke a plugin or special command.

## Recommended prompts

### Build a feature

```text
Build <feature>. Follow the repository delivery loop and do not stop until lint, typecheck, tests, build, and manual browser QA pass where applicable.
```

### Fix a bug

```text
Reproduce and fix <bug>. Prove the original failure, add a regression test when useful, and manually verify the corrected user flow.
```

### Review changes

```text
Review the current changes. Report correctness, security, accessibility, performance, and regression findings first. Do not edit files.
```

### Plan before coding

```text
Plan <feature> before coding. Inspect the repository, resolve implementation decisions, list exact files and verification scenarios, then stop for approval.
```

### Run the full quality loop

```text
Finish the current webapp task end to end: inspect, implement, run all applicable checks, exercise the real UI, review the diff, and fix every issue found before reporting completion.
```

## First-use check

Start a new Codex task from this repository and ask:

```text
Summarize the project instructions you loaded and list the delivery loop without changing files.
```

The answer should mention the Windows-first environment and the seven-step Explore → Plan → Implement → Verify → Manual QA → Review → Report loop.

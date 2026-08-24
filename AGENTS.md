# webapp_travel_schedule working agreement

This repository is a Windows-first web application project. Treat the user's requested outcome as the source of truth and complete it end to end.

## Intent and scope

- For build, change, or fix requests: inspect, implement, verify, and manually exercise the changed surface.
- For review, explanation, or diagnosis requests: inspect and report; do not edit unless the user also asks for a change.
- For plan-only requests: produce a decision-complete plan and stop before editing product code.
- Preserve existing user changes. Do not rewrite unrelated files or broaden the feature without a blocking reason.
- Prefer the smallest correct change over speculative abstractions or dependency additions.

## Windows environment

- Use native PowerShell commands on Windows unless the repository explicitly requires another shell.
- Quote paths and use `-LiteralPath` for filesystem operations when practical.
- Never use WSL paths or assume Unix-only utilities are installed.
- Do not install global tools when a project-local or `npx`/package-manager invocation is sufficient.
- Ask before adding a production dependency, changing secrets, deleting data, or making an external deployment.

## Repository discovery

Before editing:

1. Read the nearest `AGENTS.md` or `AGENTS.override.md` files that apply.
2. Inspect the relevant source, tests, configuration, and existing scripts.
3. Identify the package manager from the lockfile:
   - `pnpm-lock.yaml` → `pnpm`
   - `yarn.lock` → `yarn`
   - `bun.lock` or `bun.lockb` → `bun`
   - `package-lock.json` → `npm`
4. Use scripts already defined in `package.json`; do not invent a command when the repository exposes a canonical one.
5. For work spanning multiple files or involving uncertainty, state a short plan before implementation.

## Delivery loop

For every implementation request, follow this loop until the requested behavior is proven or a genuine blocker requires the user:

1. **Explore** — locate the behavior, dependencies, tests, and user-facing surface.
2. **Plan** — name the files and observable outcomes for multi-step work.
3. **Implement** — make a focused change that follows existing patterns.
4. **Verify** — run the applicable checks in this order when they exist:
   - formatter or formatting check
   - lint
   - typecheck
   - targeted tests
   - full relevant test suite
   - production build
5. **Manual QA** — exercise the real changed surface, not only unit tests.
6. **Review** — inspect the final diff for regressions, security, accessibility, performance, and accidental scope.
7. **Report** — lead with the outcome and cite the commands or scenarios that passed.

When a check fails, diagnose the cause, fix the root issue, and rerun the smallest affected check. Run one final complete applicable verification pass after the inputs change. Never disable, delete, or weaken a failing test merely to obtain a green result.

## Web application quality bar

- Build semantic, responsive interfaces that work with keyboard navigation.
- Preserve visible focus states and accessible labels for interactive controls.
- Handle loading, empty, error, and success states when the feature can reach them.
- Check narrow mobile, tablet, and desktop layouts after UI changes.
- Respect reduced-motion preferences for nonessential animation.
- Avoid layout shifts, unnecessary client-side work, and oversized dependencies.
- Keep secrets and privileged operations out of browser-delivered code.
- Validate untrusted input at system boundaries and encode output for its destination.
- Do not use screenshots or large hardcoded pixel maps as substitutes for live UI.

## Manual QA expectations

- UI or interaction change: open the app and test the primary scenario plus one important failure or edge scenario.
- Responsive change: inspect approximately 375 px, 768 px, and a desktop width.
- API change: exercise the real endpoint and verify status, response shape, and one invalid-input case.
- Data mutation: verify both persisted result and visible user feedback.
- Bug fix: reproduce the original failure first when practical, then demonstrate it no longer occurs.

If the app cannot be launched, report the exact blocker and perform the strongest available static or automated verification instead.

## Code Review Rules

Review findings before summaries and order them by severity.

- Flag behavior that contradicts the requested user outcome.
- Flag missing authorization, secret exposure, injection risks, unsafe redirects, and insecure client-side trust.
- Flag broken keyboard access, missing accessible names, focus loss, contrast regressions, and clipped responsive layouts.
- Flag unhandled loading, error, and empty states that users can reach.
- Flag changes that bypass established tests, types, validation, or repository conventions.
- Include a precise file and line reference for every actionable finding.
- If no findings remain, say so and name any verification gap or residual risk.

## Completion contract

Do not claim completion until all applicable items are true:

- The requested behavior is implemented.
- Changed files have no known diagnostics errors.
- Applicable tests and production build pass.
- The real user-facing surface has been exercised when runnable.
- The final diff contains no unrelated edits.
- The handoff states what changed, what passed, and what could not be verified.


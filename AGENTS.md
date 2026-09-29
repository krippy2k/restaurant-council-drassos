# restaurant-council-drassos

TypeScript Restaurant Council app (backend + frontend) on Drassos. Automated tests are part of the work, not follow-up.

Run backend tests with `npm test` (`vitest run`) in `backend/`. Frontend routing, auth, and session UI need Vitest (or the same runner) in `frontend/` as well — add that package’s test script if it is missing. Do not add a *different* framework (for example Cypress on top of Vitest) without a strong reason. Do not skip frontend tests because the folder had none. The API is the TypeScript backend; do not bind the Java engine console on 3100 from this project.

## Coverage

For every production change, add or update the layers that actually apply:

1. **Unit** — functions, modules, workflow/command parsing, domain rules, edge cases.
2. **Integration** — stores, APIs, Drassos workflow execution, tool/agent boundaries, Google Places or other external adapters when the boundary is what you are verifying.
3. **End-to-end / UI** — host/guest flows that are user-visible (create event, change request, council, invitations) and client routing (sign-out must return to `/` so the next login opens the dashboard).

Do not add low-value tests to inflate counts. If a layer is not applicable, say why in the summary.

A task is not done until implementation and the applicable tests are in the same change, existing relevant tests still pass, and new tests fail if the protected behavior is broken.

## Bug fixes

Reproduce the defect in an automated test **before** changing production code. Confirm the new test fails for the expected reason, then make the smallest fix, then confirm it passes. Keep the regression test.

Use the lowest layer that faithfully reproduces the bug. Do not patch first and test later because the fix looks obvious. Do not skip, weaken, or rewrite a valid failing test to make a fix look green.

If an automated reproduction is impractical, stop and explain why, what can be automated instead, and residual risk.

## Test quality

Tests specify behavior, not private implementation. Keep them deterministic; name them by scenario and outcome; cover failure and boundary paths. No arbitrary sleeps, shared mutable state, or order dependence. Do not mock the subject under test.

When relevant to Drassos usage, cover workflow/step transitions, human-in-the-loop suspend/resume, retries, and durable replay.

## Execution

Do not claim completion without running the relevant tests when the environment allows it. For UI changes, verify in the browser (or the closest substitute) as well. Report what tests changed, commands run, pass/fail, and anything that could not be run.

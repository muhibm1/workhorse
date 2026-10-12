# Known pre-existing failures

Checks that fail on the base branch before any change touched them. Recorded once by the
verifier with the base-branch reproduction; every later phase cites the row instead of
re-deriving it. Remove a row when the failure is fixed.

| Date | Check | Command | Reproduced on base | Reason | Recorded by change |
|------|-------|---------|--------------------|--------|--------------------|
| 2026-09-29 | e2e | npm --prefix desk run e2e | a7f107e | believed, not verified at base: smoke.spec.ts locators 'Studbook' and fleet card are ambiguous (strict mode, 2 elements); this change touches only agents/*.md and no file under desk/ | 2026-09-29-studbook-tools-for-designer-and-discovery-analys |
| 2026-09-29 | e2e | npm --prefix desk run e2e | a7f107e7bc07790baabf8aed875c7f1e3f6e5ef7 | Paddock's Playwright smoke test is flaky on this machine (failed 2 of 3 passes on 2026-09-29, toBeVisible timeout) and Paddock is retired; the change touches no desk/ file. Its failed runs also write desk/playwright-report, which eslint does not ignore | 2026-09-29-studbook-tools-for-designer-and-discovery-analys |

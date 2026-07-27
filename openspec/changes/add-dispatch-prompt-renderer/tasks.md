## 1. Test harness and fixtures

- [ ] 1.1 Create `projects/agents/utils/` and add `dispatch_prompt_test.py` alongside the utility, following the `projects/agents/scripts/install_test.py` conventions (stdlib `unittest`, temp dirs, no network)
- [ ] 1.2 Add a fixture templates root under the test's temp dir containing minimal stand-ins for all four templates — column-0 outer fence, `prompt: |` body, an indented inner ` ```bash ` fence in the `code-reviewer` stand-in, and the declared placeholder tokens (dpr-2, dpr-4)
- [ ] 1.3 Add a `xagent-test`-style Makefile target `agents-utils-test` in `projects/agents/Makefile` that runs the new test, and confirm it fails cleanly before implementation exists

## 2. Template resolution

- [ ] 2.1 RED: test that the highest installed Superpowers version is selected when several version dirs exist in the templates root (dpr-3)
- [ ] 2.2 RED: test that an explicit templates root overrides the version scan entirely (dpr-3)
- [ ] 2.3 RED: test that an unresolvable template source exits non-zero and the message names every path searched (dpr-3)
- [ ] 2.4 GREEN: implement version-tuple-sorted resolution with `--templates-root` and its environment-variable equivalent (D6)

## 3. Prompt body extraction

- [ ] 3.1 RED: test that rendering emits only the `prompt: |` body — no title heading, no `Subagent`/`description`/`model` scaffold, no `**Placeholders:**` list, no returns note (dpr-4)
- [ ] 3.2 RED: test that an indented inner fence in the body survives extraction and that the outer column-0 fence terminates it (dpr-4, D2)
- [ ] 3.3 RED: test that every non-placeholder body line appears unmodified apart from dedenting (dpr-4)
- [ ] 3.4 GREEN: implement column-0-fence extraction and common-indentation dedent

## 4. Placeholder manifest and substitution

- [ ] 4.1 Write the manifest: for each of the four template names, the `(token, option, required, kind)` tuples, with `kind` in `{literal, file}` (D3)
- [ ] 4.2 RED: test that each supported template name resolves and that an unsupported name exits non-zero listing the four supported names (dpr-2)
- [ ] 4.3 RED: test that a missing required placeholder exits non-zero naming the unsatisfied placeholder, and that no output file is written (dpr-5, dpr-1)
- [ ] 4.4 RED: test that a successful render leaves no unsubstituted token for any required placeholder (dpr-5)
- [ ] 4.5 GREEN: implement manifest-driven substitution, reading `kind: file` values from disk
- [ ] 4.6 RED then GREEN: declared-placeholder drift check — a template missing a declared token exits non-zero naming template, resolved source, and token; a matching template renders without the error (dpr-8, D5)

## 5. Workspace derivation and constraints default

- [ ] 5.1 RED: test that the plan workspace resolves to `<repo-root>/.superpowers/sdd/<plan-basename>/`, matching `sdd-workspace`, and that report and output paths derive from plan plus task number (D4)
- [ ] 5.1a RED: test that `--brief` is required for templates carrying the placeholder, that a nonexistent or empty brief path exits non-zero naming the path, and that the rendered prompt contains the brief's path but not its body text (dpr-9, D4a)
- [ ] 5.2 RED: test that `--constraints` defaults to the workspace's `global-constraints.md` when it exists, for templates carrying that placeholder (dpr-6)
- [ ] 5.3 RED: test that an explicit `--constraints` file overrides the workspace default (dpr-6)
- [ ] 5.4 RED: test that `--constraints` supplied for a template with no such placeholder exits non-zero, naming the template and the rejected option (dpr-6)
- [ ] 5.5 GREEN: implement workspace resolution, derived inputs, and constraints defaulting, keeping every derived value overridable

## 6. Output contract

- [ ] 6.1 RED: test that a successful render prints exactly the absolute output path on stdout and exits zero (dpr-1)
- [ ] 6.2 RED: test that implementer and task-reviewer renders for the same task land at different paths (dpr-7)
- [ ] 6.3 RED: test that successive re-review rounds for one task land at different paths (dpr-7)
- [ ] 6.4 RED: test that a failing render creates and overwrites nothing, including when an existing output file is present (dpr-1)
- [ ] 6.5 GREEN: implement role-distinct naming and atomic temp-file-plus-rename writes (D7)

## 7. Integration verification

- [ ] 7.1 Run the utility against the real installed Superpowers templates for all four names and confirm the drift check passes at the currently installed version
- [ ] 7.2 Diff a real rendered `task-reviewer` output against the upstream template body to confirm the rubric sections survive intact — Do Not Trust the Report, the cross-cutting/call-sites clause, Part 2 Code Quality, and Calibration
- [ ] 7.3 Confirm rendered files land inside the self-ignoring `.superpowers/sdd/` workspace and do not appear in `git status`
- [ ] 7.4 Run `make agents-utils-test` and the existing `projects/agents` test targets; record commands and output in the task report
- [ ] 7.5 Run `openspec validate add-dispatch-prompt-renderer --strict` and `git diff --check`

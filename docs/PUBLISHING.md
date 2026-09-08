# Private Repository Sharing

Use this checklist before inviting anyone to the private GitHub repository.

## Privacy gate

- Stop the running application before making a private backup.
- Confirm that `data/`, `*.sqlite3`, exported JSON backups, and exported CSV reports are ignored.
- Run `git status --ignored` and verify private files appear only as ignored entries.
- Inspect the complete staged file list with `git diff --cached --name-only`.
- Search tracked files for names, contact details, account identifiers, and real financial notes.
- Use only the fictional built-in example in screenshots and demonstrations.
- Keep the original supplied specification outside version control.

Private GitHub access limits who can browse the repository, but every invited collaborator can clone and retain all tracked files. Keep personal financial data outside Git even when access is restricted.

## Quality gate

- Run `python -m unittest discover -v`.
- Run the application from a fresh clone or copied folder.
- Check the empty-state and fictional example workflows.
- Verify desktop and narrow layouts in a current browser.
- Confirm README image and document links resolve on GitHub.
- Confirm the GitHub Actions workflow completes on every matrix entry.

## Suggested GitHub metadata

**Description**

> Privacy-first local financial scenario modeller for daily cash-flow feasibility and NPV, built with exact decimal arithmetic, SQLite, and 87 automated tests.

**Topics**

`python`, `javascript`, `sqlite`, `financial-modeling`, `cash-flow`, `npv`, `personal-finance`, `local-first`, `privacy`, `zero-dependency`

**Social preview**

Upload `docs/assets/social-preview.png` in the repository's social-preview settings.

## Repository access

1. Create the GitHub repository as **Private**.
2. Push the prepared `main` branch.
3. Invite only the intended collaborators through the repository's access settings.
4. Give read access unless a collaborator needs to change the project.
5. Review the collaborator list periodically and remove access that is no longer needed.

No license file is needed for this private, invite-only repository. The owner retains the default rights to the project.

## Sharing boundary

The repository should contain source code, fictional fixtures, documentation, portfolio screenshots, and automated tests. The owner's live database, exports, source specification, generated reports, and cache files remain local.

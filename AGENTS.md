This file defines working conventions for coding agents in this repository.
- Package manager: `npm`
- Main source folders: `cli/`, `lib/`
- Tests: `tests/`
Run these commands from the repository root:
```bash
npm install
```
Useful commands:
```bash
npm test
```
If additional scripts are added to `package.json`, prefer those project scripts over custom one-off commands.
- Keep changes focused and minimal.
- Match existing code style and naming patterns.
- Avoid unrelated refactors in the same change.
- Add or update tests when behavior changes.
- This `AGENTS.md` applies to the entire repository unless a deeper `AGENTS.md` overrides it.
- Follow the most specific `AGENTS.md` for any file you edit.
Before finalizing changes:
1. Install dependencies (`npm install`) if needed.
2. Run relevant tests (`npm test` or targeted tests).
3. Ensure no generated artifacts are accidentally committed.
- Do not run destructive git commands unless explicitly requested.
- Do not revert user changes outside the requested scope.

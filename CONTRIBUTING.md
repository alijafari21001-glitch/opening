# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

1. Open an issue first for anything bigger than a bug fix, so we can agree on the approach.
2. `cd opencell && npm ci && npm test` must pass. For changes to the pages, run `tests/workbench.e2e.js` too (see the README).
3. Keep it clean-room: don't copy code, screenshots, manuals, logos or files from FANUC, Rockwell, ABB, Yaskawa, UR or any other vendor. Vendor names are fine only to describe compatibility.
4. Don't add course lab solutions or anything a school would consider graded work.
5. Escape any text from a file or user before putting it into HTML, and never add network calls to new hosts without updating `workbench/tools/add_csp.py` and `SECURITY.md`.
6. By contributing you agree your work is released under the MIT license.

Be kind; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

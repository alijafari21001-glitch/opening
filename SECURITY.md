# Security policy

## Reporting a problem

Please report security problems privately with GitHub's **Report a vulnerability** button on the Security tab of this repository, not in a public issue. You'll get an answer within 7 days. Include the page or file, the steps to reproduce, and what an attacker could do.

## What we protect

- **Accounts:** sign-in is email one-time codes through Supabase; no passwords are stored by this project. The Supabase anon key in the pages is public by design. Every saved project row is protected by row-level security (`auth.uid() = user_id`), so one user can't read or change another user's work. The `service_role` key is never used in this repository.
- **Pages:** every public page sends a Content-Security-Policy (`workbench/tools/add_csp.py`). Pages can only send data to their own site, Supabase and a bridge on this computer, so injected code couldn't ship your work or sign-in session to anyone else.
- **Files you open:** project, cell and panel files can come from anyone. Names and tags are escaped before they are shown, and OpenPanel checks every opened file for known part types and plain values.
- **Bridge:** `bridge/` listens on `127.0.0.1` only, refuses WebSocket connections from other websites, and limits message size. Modbus TCP and OPC UA have no authentication: expose them to a network (`--host 0.0.0.0`) only if it's trusted and isolated.
- **Simulation only:** nothing here talks to real machines unless you run the bridge and connect it yourself. Never use it to control real equipment that can hurt people.

## Supported versions

Only the current `main` branch (the live site) gets fixes.

# Worklane development rules

## Scope and stack

- Single-user, local-first task management with React, TypeScript, Vite, CSS Modules, Tabler Icons and Zod.
- Local JSON persistence; no database server, backend API or authentication.
- Make small, reviewable changes. Avoid unnecessary abstractions, dependencies and operational tooling.
- Use dummy data for development and tests. Never use real business data.

## UI

- Light mode only; maintain a dense, readable list-first interface.
- Keep typography and icons consistent. Avoid decorative cards and excessive gradients.
- Use concise, natural Japanese. No poetic, emotional or abstract UI copy.
- Prefer segments, selection buttons and filter chips. Do not use ordinary dropdowns or native-looking radio buttons.
- Use searchable dialogs for many candidates.
- Preserve semantic accessibility, visible focus, Tab/arrow/Enter/Space operation and dialog focus restoration.
- Preserve native file and permission dialogs.

## Security

- Security takes priority over features. Never transmit business data externally.
- No runtime external requests, CDN, analytics, telemetry or remote fonts.
- Related URLs are data only; no external navigation or automatic clipboard operations.
- Do not use dangerouslySetInnerHTML or interpret input as HTML.
- Validate all external data and URLs; reject dangerous schemes.
- Never log business data or store it in the repository.
- Do not add dependencies without approval or execute unreviewed remote scripts.
- Keep npm install scripts disabled and audit dependencies.
- Bind local servers only to 127.0.0.1. Preserve production CSP, HTTP access restrictions and file validation.
- Keep development-only network behavior out of production.

## Persistence

- Access only user-authorized JSON files. The user selected a persistent, Git-ignored data/ folder inside the project as the default storage location; previously selected external folders remain supported. Keep data/ and its backups out of Git and preserve them during source updates and cleanup.
- Validate the complete schema with Zod, including version, limits, IDs and references.
- Serialize writes, detect concurrent edits, and verify saved contents.
- Protect existing data with recoverable backups; handle permission loss and write failures.
- Never silently discard unsaved changes or delete business data and backups.
- Review schema compatibility and recovery before changing the data format.

## Validation and operation

- Run TypeScript, lint, build and relevant tests; add tests for critical behavior.
- Follow TESTING.md and distinguish simulated file APIs from real filesystem tests.
- Report security implications and unverified behavior without claiming guaranteed safety.
- Use npm start for production, never the Vite development server.
- Keep source updates separate from business data. No dedicated installers, distribution ZIP generators or updaters.
- Do not commit, push or change repository visibility without authorization.
- Business use requires validation in the target environment and compliance with organizational policies.

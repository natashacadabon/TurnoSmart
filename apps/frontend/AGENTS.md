<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TurnoSmart — Development Instructions

## Project

TurnoSmart is an academic SaaS appointment management application.

Stack:

- Monorepo with npm workspaces
- Frontend: Next.js, React, TypeScript, MUI
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL, Prisma, Supabase
- Shared contracts: packages/shared

## Architecture

Three development modules:

- A: Authentication, authorization and business context.
- B: Services, availability rules and slots.
- C: Appointment management and booking lifecycle.

Respect module boundaries and approved API contracts.

## Development rules

- Follow existing project conventions and TypeScript patterns.
- Prefer simple, maintainable solutions.
- Inspect relevant code before making changes.
- Do not invent endpoints, models or implemented functionality.
- Distinguish documented proposals from approved decisions.
- Avoid unnecessary dependencies and abstractions.
- Do not modify unrelated modules without authorization.
- Do not modify Prisma schema or migrations without explicit approval.
- Never read, display or modify .env secrets unnecessarily.
- Never commit credentials, tokens or private keys.

## Git

- Use feature branches and pull requests.
- Follow Conventional Commits.
- Keep changes focused on the requested task.
- Do not commit or push automatically without permission.

## Quality

- Validate input at runtime.
- Respect authentication, authorization and tenant isolation.
- Add meaningful tests for new functionality.
- Report tests actually executed.
- Never claim tests passed without executing them.
- Explain relevant technical decisions and tradeoffs.

## Academic and infrastructure constraints

- Prioritize educational value and reproducibility.
- Prefer local development and existing free resources.
- Avoid unnecessary cloud costs.
- Do not deploy to Azure unless explicitly requested.
- Do not leave billable infrastructure running.

## Agent collaboration

- Use specialized agents for independent reviews.
- Avoid simultaneous modifications to the same files.
- Keep the main agent responsible for final integration.

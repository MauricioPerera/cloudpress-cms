# CloudPress

CloudPress is a WordPress-inspired administration platform built for **Cloudflare Pages**. It includes native user/password authentication, a WordPress-style admin workspace, content and taxonomy management, media in R2, D1 persistence, an extensible plugin contract, and WebMCP tools so browser agents can work through the product's own authorization and validation rules.

> The production deployment is available at [auth-free-test-20260915.pages.dev](https://auth-free-test-20260915.pages.dev/).

## Deploy to Cloudflare Pages

[![Deploy with Cloudflare Pages](https://img.shields.io/badge/Deploy%20with-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)

CloudPress is a **Pages** application. The official one-click **Deploy to Cloudflare** button is currently for Workers applications, so this badge leads to the supported Pages Git-integration deployment flow rather than pretending it is a one-click Pages installer.

1. Fork this public repository.
2. In Cloudflare, create a Pages project and connect the fork using the badge above.
3. Use `.` as the build output directory and leave the build command empty.
4. Create a D1 database and an R2 bucket in your Cloudflare account.
5. Add the Pages bindings named `DB` (D1) and `MEDIA` (R2) in **Settings → Bindings**.
6. Apply [`schema.sql`](schema.sql) to the D1 database, then configure the application secrets in the Pages project.

Cloudflare Pages Functions are detected from the [`functions/`](functions/) directory during the Git deployment.

For the complete initial-deployment, upgrade, backup and production-smoke-test procedure, follow [`docs/DEPLOYMENT_RUNBOOK.md`](docs/DEPLOYMENT_RUNBOOK.md). A new database uses `schema.sql`; an existing database uses only the unapplied numbered migrations, in order.

## Local configuration

The repository intentionally does not include the live `wrangler.jsonc`, because it contains account-specific Cloudflare resource identifiers. Create your own local configuration:

```powershell
Copy-Item wrangler.example.jsonc wrangler.jsonc
```

Replace `YOUR_D1_DATABASE_ID`, then create the database schema:

```powershell
wrangler d1 execute cloudpress-db --remote --file schema.sql
```

For a direct Pages upload after configuring your own bindings:

```powershell
wrangler pages deploy . --project-name cloudpress --branch main
```

## Architecture

| Area | Cloudflare service |
| --- | --- |
| Static frontend and edge routes | Pages + Pages Functions |
| Users, sessions, content, taxonomies, audit data | D1 |
| Media library | R2 |
| Scheduled publication and plugin jobs | Separate Cloudflare Worker + Cron Trigger |
| Recuperación de cuenta | Google Authenticator (TOTP) + PIN local LSFA; correo opcional |
| Agent administration | WebMCP, exposed only to authenticated administrators |
| Authoring | Native structured block documents, rendered to sanitized HTML |

## Agent onboarding and plugins

- [`agent-setup/prompt.md`](agent-setup/prompt.md) is the safe operating guide copied by the public onboarding button.
- [`plugins/LLM_PLUGIN_PROMPT.md`](plugins/LLM_PLUGIN_PROMPT.md) is the exact contract for an LLM to create, review and validate a CloudPress plugin. The local SDK validator parses code without importing or executing it, blocks prohibited capabilities, and emits source and manifest hashes which are included in the compiled registry. A browser agent can then install, activate, or select an archived release only when its attested hash is already present in that deployment.
- FastWebMCP operations use the same server-side authorization and soft-delete safeguards as the UI. Agents must not handle passwords or session cookies. Irreversible operations require the LSFA companion described in [`docs/FASTWEBMCP_LSFA.md`](docs/FASTWEBMCP_LSFA.md).

En Perfil, cada usuario puede activar un autenticador compatible con Google Authenticator. CloudPress cifra el secreto TOTP con el secreto de Pages TOTP_ENCRYPTION_KEY y ofrece códigos de respaldo de un solo uso. La recuperación sin correo se realiza en [totp-recovery.html](totp-recovery.html) mediante el companion LSFA local: CloudPress verifica el OTP y LSFA exige el PIN local antes del cambio de contraseña.

## Security notes

Do not commit `.dev.vars`, `wrangler.jsonc`, access tokens, SMTP/Resend credentials, or production resource identifiers. The provided `.gitignore` excludes local configuration and runtime artifacts.

All browser mutations are checked in the Pages middleware: requests must be same-origin (or carry same-origin fetch metadata). Plugin webhook requests with their dedicated token header are allowed through to their endpoint, which verifies that token. This is an additional CSRF defense; session authorization is still enforced by each API route.

Plugins are source-controlled code compiled into the Pages Functions bundle. The plugin contract limits the host APIs exposed to a plugin, but it is **not** a runtime sandbox for arbitrary third-party code. The deterministic validator is a technical-policy gate, not proof that a plugin fulfils a business request. The creating agent must inspect the code, keep permissions minimal, run acceptance tests for the requested behavior, and only then deploy and install it. A pinned release is selected by its attested source hash; if a requested hash is absent from the current bundle, CloudPress fails closed rather than executing the latest code. Archived release source must be preserved in `plugins/<id>/releases/<version>/` before it can be selected.

The core exposes a fixed content lifecycle to plugins: create, update, trash and restore, each with `before*` and `after*` hooks. `beforeCreate` and `beforeUpdate` may apply the constrained content patch; all other `before*` hooks may veto. Plugins cannot define arbitrary hook names, which prevents a manifest from claiming an event the core never dispatches.

CloudPress has its own block-editor document model; it does not load WordPress Gutenberg. `content_documents.blocks_json` is the structured source for block-authored content and `content_items.body` is its server-rendered, sanitized HTML counterpart. Existing HTML content opens as a preserved legacy block. Plugins can declare namespaced blocks through `blocks:define`; the core renders their attribute inspector from the manifest schema and executes only their statically compiled, validator-attested renderer.

Publication scheduling and queued plugin tasks run in the separate [`scheduler/`](scheduler/) Worker, because Pages Functions do not receive Cron Trigger events. A future publication is stored as a draft with its `published_at` timestamp; the scheduler atomically promotes it when due. Plugin jobs run only while their plugin remains enabled, are claimed atomically, and a job left in `running` state for 20 minutes is made available again on the next run. See the deployment runbook before enabling the trigger.

## Quality gates

Run `npm test` before opening a pull request. It validates the plugin registry and contract, the plugin host and administrative UI, the same-origin mutation guard, the fresh-database schema contract, and JavaScript syntax. GitHub Actions runs that same command for pull requests and pushes to `main`.

## License

No license has been selected yet. Add one before accepting outside contributions or distributing reusable derivatives.

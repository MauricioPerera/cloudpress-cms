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
| Password reset delivery | Resend-compatible transactional email configuration |
| Agent administration | WebMCP, exposed only to authenticated administrators |

## Agent onboarding and plugins

- [`agent-setup/prompt.md`](agent-setup/prompt.md) is the safe operating guide copied by the public onboarding button.
- [`plugins/LLM_PLUGIN_PROMPT.md`](plugins/LLM_PLUGIN_PROMPT.md) is the exact contract for an LLM to create and validate a CloudPress plugin.
- WebMCP operations use the same server-side authorization and soft-delete safeguards as the UI. Agents must not handle passwords or session cookies.

## Security notes

Do not commit `.dev.vars`, `wrangler.jsonc`, access tokens, SMTP/Resend credentials, or production resource identifiers. The provided `.gitignore` excludes local configuration and runtime artifacts.

## License

No license has been selected yet. Add one before accepting outside contributions or distributing reusable derivatives.

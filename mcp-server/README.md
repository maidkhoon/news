# BazaarNexa Local MCP for Claude Code

This local stdio MCP server lets Claude Code inspect BazaarNexa admin content, check likely title duplicates, and create or edit **drafts only** through the existing Render admin API.

## Safety model

- Authenticates to Supabase using a dedicated admin account's local credentials.
- Checks that the signed-in user's `profiles.role` is `ADMIN` and `profiles.status` is `true`.
- Uses short-lived Supabase access tokens and refreshes them when possible.
- Calls the existing `/api/admin/categories` and `/api/admin/articles` endpoints; it does not connect with a service-role key or write directly to the database.
- `save_draft` always sends `status: "DRAFT"`.
- `update_draft` refuses to edit anything except a current `DRAFT`.
- There is intentionally no publish/delete tool.
- Secrets belong in a local ignored `.env`; never commit it or paste credentials into chat.

## Requirements

- Node.js 20 or newer.
- A Supabase user dedicated to this local workflow, with a matching enabled `profiles` row whose role is `ADMIN`.
- That user must be able to sign in with email/password. If the project requires MFA or disables password auth, use the project's approved auth method rather than bypassing it.
- The existing Render API must be deployed and reachable.

## Install

From the repository root:

```bash
cd mcp-server
npm install
cp .env.example .env
```

Edit `mcp-server/.env` locally with your Supabase project URL, public anon/publishable key, and dedicated admin login. Do not use `SUPABASE_SERVICE_ROLE_KEY` here. Keep the default API URL unless you have a separate staging API.

Check syntax:

```bash
npm run check
```

## Connect Claude Code

From the repository root, add this to the project's `.mcp.json` (or merge it into your existing file). Claude Code starts the process from the repository root:

```json
{
  "mcpServers": {
    "bazaarnexa": {
      "command": "node",
      "args": ["./mcp-server/src/index.js"],
      "env": {
        "SUPABASE_URL": "https://YOUR_PROJECT.supabase.co",
        "SUPABASE_ANON_KEY": "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY",
        "BAZAARNEXA_ADMIN_EMAIL": "your-dedicated-admin@example.com",
        "BAZAARNEXA_ADMIN_PASSWORD": "set-this-in-your-local-environment",
        "BAZAARNEXA_API_URL": "https://news-api-egmd.onrender.com"
      }
    }
  }
}
```

**Secret handling:** Prefer environment-variable references supported by your Claude Code version or run Claude Code in a shell where these variables are set. Avoid committing real values in `.mcp.json`. If you use literal values locally, ensure the file is gitignored and never share it. The server itself reads environment variables and `mcp-server/.env`; Claude Code does not automatically load that nested .env when launching from the repository root, so either export those variables in your shell or configure the MCP process to load `dotenv/config` from its own directory (see note below).

### Easier local launch using a wrapper

Run from the repo root with the environment loaded from the MCP folder:

PowerShell:
```powershell
Get-Content .\mcp-server\.env | Where-Object { $_ -match '^\s*[^#][^=]*=' } | ForEach-Object {
  $pair = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim(), 'Process')
}
claude
```

On macOS/Linux, export the variables in your shell before running `claude`. Do not print secrets in logs or commit shell history containing them.

## Tools available to Claude Code

- `list_categories`: category IDs and names.
- `list_articles`: recent articles, optionally filtered by status.
- `get_article`: look up an article by UUID or slug among the latest 100 records.
- `check_duplicates`: simple title overlap check against recent articles.
- `save_draft`: creates an unpublished draft and stores source metadata.
- `update_draft`: updates a draft only.

## Example prompt

"Research the latest important India technology news. Use reliable original sources, distinguish verified facts from uncertainty, check BazaarNexa for duplicate headlines, then create two well-sourced drafts in the appropriate categories. Do not publish anything."

Claude's research capability depends on the tools available in the Claude Code session. The MCP server itself does not browse the web or independently verify claims.

## Important limitations

- Title duplicate detection is heuristic and only checks the latest 100 admin articles.
- Article list lookup tools inspect at most 100 records per operation.
- Draft creation needs an existing category UUID.
- The server requires a compatible Supabase email/password sign-in and an enabled ADMIN profile.
- No publishing, deleting, or category mutation tools are exposed.

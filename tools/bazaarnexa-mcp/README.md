# BazaarNexa local Claude Code MCP

A local **stdio** MCP server for Claude Code. It reuses BazaarNexa's existing admin API and Supabase-backed authorization; it does not connect directly to Supabase and does not require a service-role key.

## Safety defaults

- Requires a Supabase **user access token** belonging to an enabled `ADMIN` profile. The backend verifies the bearer token and admin role.
- Exposes read tools for categories and articles, plus create/update tools for drafts.
- New articles are explicitly sent with `status: "DRAFT"`.
- Updates are refused unless the article is currently `DRAFT`.
- No publish, delete, user/role, direct database, or schema-mutation tools are exposed.
- Keep the token private; do not commit a real `.env` file or paste tokens into prompts.

## Setup

Requirements: Node.js 20+ and a BazaarNexa admin account.

1. Open a terminal in this directory.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and set `BAZAARNEXA_ACCESS_TOKEN` to your Supabase session access token. The token expires; replace it when needed. Do not use a Supabase service-role key.
4. Register the MCP server in your Claude Code user configuration. Example `~/.claude.json` / project-local `.mcp.json` entry (adjust the absolute path):

```json
{
  "mcpServers": {
    "bazaarnexa": {
      "command": "node",
      "args": ["/absolute/path/to/news/tools/bazaarnexa-mcp/src/index.js"],
      "env": {
        "BAZAARNEXA_API_URL": "https://news-api-egmd.onrender.com",
        "BAZAARNEXA_ACCESS_TOKEN": "YOUR_SUPABASE_USER_ACCESS_TOKEN"
      }
    }
  }
}
```

Prefer keeping secrets in your local environment instead of committing them to a project config. If Claude Code inherits environment variables, omit the token from the config and export it in the launching shell. Restart Claude Code, then confirm the `bazaarnexa_list_categories` tool works.

## Tools

- `bazaarnexa_list_categories` — list current categories.
- `bazaarnexa_list_articles` — list articles, with pagination.
- `bazaarnexa_create_draft` — create a DRAFT.
- `bazaarnexa_update_draft` — update an existing DRAFT only.

## Existing API/schema notes

The implementation uses the existing `/api/admin/categories` and `/api/admin/articles` endpoints. Article fields follow the existing admin API's accepted fields and the existing `articles` / `categories` model; no database migration or new endpoint is introduced. The repository SQL schema currently lists `title`, `slug`, `content`, `category_id`, `created_by`, `image_url`, `access_type`, and `status` on articles. The existing admin route also references `source_url` and `source_name`; this MCP deliberately does not depend on those optional fields.

## Validation

Run `npm install` then `npm start`. The MCP process uses stdio, so logs go to stderr and the server should be launched by Claude Code rather than as a public web service. Verify with an ADMIN token and test that a created article remains DRAFT in the admin panel.

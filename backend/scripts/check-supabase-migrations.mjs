import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const entries = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
const errors = [];
const versions = new Map();

for (const filename of entries) {
  const match = /^(\d{12,14})_([a-z0-9_]+)\.sql$/.exec(filename);
  if (!match) {
    errors.push("Invalid migration filename: " + filename + " (expected <12-14 digit version>_<lowercase_name>.sql)");
    continue;
  }
  const version = match[1];
  const previous = versions.get(version);
  if (previous) errors.push("Duplicate migration version " + version + ": " + previous + " and " + filename);
  else versions.set(version, filename);
}

const indexVersion = [...versions.keys()].find((v) => versions.get(v) === "202610140001_article_admin_listing_indexes.sql");
const trgmVersion = [...versions.keys()].find((v) => versions.get(v) === "202610140004_pg_trgm_extensions_schema.sql");
const tableVersion = [...versions.keys()].find((v) => versions.get(v) === "202610140002_idempotency_keys.sql");
const leaseVersion = [...versions.keys()].find((v) => versions.get(v) === "202610140003_idempotency_keys_claim_lease.sql");

if (indexVersion && trgmVersion && Number(trgmVersion) <= Number(indexVersion)) {
  errors.push("pg_trgm schema migration must sort after the article index migration.");
}
if (tableVersion && leaseVersion && Number(leaseVersion) <= Number(tableVersion)) {
  errors.push("Idempotency lease migration must sort after the idempotency table migration.");
}

if (errors.length) {
  for (const error of errors) console.error("::error::" + error);
  process.exitCode = 1;
} else {
  console.log("Validated " + entries.length + " Supabase migration filenames: versions are unique and known dependencies are ordered.");
}

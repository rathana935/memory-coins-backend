import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.join(__dirname, "migrations");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing");
}

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
        process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : false,
    connectionTimeoutMillis: 10000
});

async function ensureMigrationTable() {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
}

async function getMigrationFiles() {
    if (!fs.existsSync(migrationsDir)) {
        throw new Error(`Migration directory not found: ${migrationsDir}`);
    }

    return fs
        .readdirSync(migrationsDir)
        .filter(file => file.endsWith(".sql"))
        .sort();
}

async function getAppliedMigrations() {
    const result = await client.query(`
        SELECT filename
        FROM schema_migrations
        ORDER BY filename;
    `);

    return new Set(result.rows.map(row => row.filename));
}

async function runMigration(filename) {
    const filePath = path.join(migrationsDir, filename);

    const sql = fs.readFileSync(filePath, "utf8").trim();

    if (!sql) {
        throw new Error(`Migration file is empty: ${filename}`);
    }

    console.log(`\n▶ Running migration: ${filename}`);

    /*
     * Migration files currently contain their own
     * BEGIN / COMMIT statements, so we execute them
     * directly instead of wrapping them in another
     * transaction.
     */
    await client.query(sql);

    /*
     * Record the migration only after it completed
     * successfully.
     */
    await client.query(
        `
        INSERT INTO schema_migrations (filename)
        VALUES ($1)
        ON CONFLICT (filename) DO NOTHING;
        `,
        [filename]
    );

    console.log(`✓ Migration completed: ${filename}`);
}

async function main() {
    try {
        console.log("========================================");
        console.log(" Memory Card Database Migration");
        console.log("========================================");

        await client.connect();

        console.log("✓ Database connected");

        await ensureMigrationTable();

        console.log("✓ Migration table ready");

        const files = await getMigrationFiles();

        if (files.length === 0) {
            console.log("No migration files found.");
            return;
        }

        const applied = await getAppliedMigrations();

        let pendingCount = 0;

        for (const filename of files) {
            if (applied.has(filename)) {
                console.log(`✓ Already applied: ${filename}`);
                continue;
            }

            await runMigration(filename);
            pendingCount++;
        }

        console.log("\n========================================");

        if (pendingCount === 0) {
            console.log("✓ Database is already up to date.");
        } else {
            console.log(`✓ Applied ${pendingCount} migration(s).`);
        }

        console.log("========================================");

    } catch (error) {
        console.error("\n✗ Migration failed:");
        console.error(error);

        process.exitCode = 1;

    } finally {
        try {
            await client.end();
        } catch {
            // Ignore connection-close errors
        }
    }
}

main();

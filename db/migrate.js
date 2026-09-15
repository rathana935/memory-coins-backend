import "dotenv/config";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;


/* =========================================================
   PATHS
========================================================= */

const __filename =
    fileURLToPath(import.meta.url);

const __dirname =
    path.dirname(__filename);

const migrationsDir =
    path.join(
        __dirname,
        "migrations"
    );


/* =========================================================
   ENVIRONMENT VALIDATION
========================================================= */

if (!process.env.DATABASE_URL) {
    throw new Error(
        "DATABASE_URL is missing."
    );
}


/* =========================================================
   DATABASE CLIENT
========================================================= */

const client =
    new Client({
        connectionString:
            process.env.DATABASE_URL,

        ssl:
            process.env.NODE_ENV === "production"
                ? {
                    rejectUnauthorized: false
                }
                : false,

        connectionTimeoutMillis:
            10000
    });


/* =========================================================
   MIGRATION TABLE
========================================================= */

async function ensureMigrationTable() {

    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
}


/* =========================================================
   FIND MIGRATION FILES
========================================================= */

function getMigrationFiles() {

    if (
        !fs.existsSync(
            migrationsDir
        )
    ) {

        throw new Error(
            `Migration directory not found: ${migrationsDir}`
        );
    }


    return fs
        .readdirSync(
            migrationsDir,
            {
                withFileTypes: true
            }
        )
        .filter(
            entry =>
                entry.isFile() &&
                entry.name.endsWith(".sql")
        )
        .map(
            entry =>
                entry.name
        )
        .sort(
            (a, b) =>
                a.localeCompare(
                    b,
                    undefined,
                    {
                        numeric: true
                    }
                )
        );
}


/* =========================================================
   GET APPLIED MIGRATIONS
========================================================= */

async function getAppliedMigrations() {

    const result =
        await client.query(`
            SELECT filename
            FROM schema_migrations
            ORDER BY filename;
        `);

    return new Set(
        result.rows.map(
            row =>
                row.filename
        )
    );
}


/* =========================================================
   RUN ONE MIGRATION
========================================================= */

async function runMigration(
    filename
) {

    const filePath =
        path.join(
            migrationsDir,
            filename
        );


    const sql =
        fs.readFileSync(
            filePath,
            "utf8"
        ).trim();


    if (!sql) {

        throw new Error(
            `Migration file is empty: ${filename}`
        );
    }


    console.log(
        `\n▶ Running migration: ${filename}`
    );


    /*
     * Current migration files contain their own
     * BEGIN / COMMIT statements.
     *
     * Therefore we execute them directly.
     */

    await client.query(
        sql
    );


    /*
     * Only record the migration after PostgreSQL
     * successfully completes the SQL.
     */

    await client.query(
        `
        INSERT INTO schema_migrations (
            filename
        )
        VALUES ($1)
        ON CONFLICT (filename)
        DO NOTHING;
        `,
        [
            filename
        ]
    );


    console.log(
        `✓ Migration completed: ${filename}`
    );
}


/* =========================================================
   MAIN
========================================================= */

async function main() {

    let exitCode = 0;

    try {

        console.log(
            "========================================"
        );

        console.log(
            " Memory Card Database Migration"
        );

        console.log(
            "========================================"
        );


        /* ---------------------------------------------
           CONNECT
        --------------------------------------------- */

        await client.connect();

        console.log(
            "✓ Database connected"
        );


        /* ---------------------------------------------
           MIGRATION TABLE
        --------------------------------------------- */

        await ensureMigrationTable();

        console.log(
            "✓ Migration table ready"
        );


        /* ---------------------------------------------
           DISCOVER FILES
        --------------------------------------------- */

        const files =
            getMigrationFiles();


        if (
            files.length === 0
        ) {

            console.log(
                "No migration files found."
            );

            return;
        }


        console.log(
            `✓ Found ${files.length} migration file(s)`
        );


        /* ---------------------------------------------
           APPLIED MIGRATIONS
        --------------------------------------------- */

        const applied =
            await getAppliedMigrations();


        let pendingCount = 0;


        /* ---------------------------------------------
           RUN PENDING MIGRATIONS
        --------------------------------------------- */

        for (
            const filename
            of files
        ) {

            if (
                applied.has(
                    filename
                )
            ) {

                console.log(
                    `✓ Already applied: ${filename}`
                );

                continue;
            }


            await runMigration(
                filename
            );


            pendingCount++;
        }


        /* ---------------------------------------------
           RESULT
        --------------------------------------------- */

        console.log(
            "\n========================================"
        );


        if (
            pendingCount === 0
        ) {

            console.log(
                "✓ Database is already up to date."
            );

        } else {

            console.log(
                `✓ Applied ${pendingCount} migration(s).`
            );
        }


        console.log(
            "========================================"
        );


    } catch (error) {

        exitCode = 1;

        console.error(
            "\n✗ Migration failed:"
        );

        console.error(
            error?.message ||
            error
        );


        if (
            error?.stack
        ) {

            console.error(
                error.stack
            );
        }


    } finally {

        try {

            await client.end();

        } catch (closeError) {

            console.error(
                "Database connection close error:",
                closeError
            );
        }


        process.exitCode =
            exitCode;
    }
}


/* =========================================================
   START
========================================================= */

main();

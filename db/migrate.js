import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client } = pg;

/* =========================================================
   PATH SETUP
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationFile = path.join(
    __dirname,
    "migrations",
    "001_adsgram_rewards.sql"
);


/* =========================================================
   MIGRATION
========================================================= */

async function migrate() {
    let client;

    try {
        console.log("========================================");
        console.log("Memory Coins Database Migration");
        console.log("========================================");


        /* -------------------------------------------------
           DATABASE URL CHECK
        ------------------------------------------------- */

        if (!process.env.DATABASE_URL) {
            throw new Error(
                "DATABASE_URL environment variable is missing."
            );
        }


        /* -------------------------------------------------
           MIGRATION FILE CHECK
        ------------------------------------------------- */

        if (!fs.existsSync(migrationFile)) {
            throw new Error(
                `Migration file not found: ${migrationFile}`
            );
        }


        /* -------------------------------------------------
           DATABASE CONNECTION
        ------------------------------------------------- */

        console.log(
            "Connecting to PostgreSQL..."
        );

        client = new Client({
            connectionString:
                process.env.DATABASE_URL,

            ssl:
                process.env.NODE_ENV === "production"
                    ? {
                        rejectUnauthorized: false
                    }
                    : false,

            connectionTimeoutMillis: 10000
        });

        await client.connect();

        console.log(
            "PostgreSQL connected."
        );


        /* -------------------------------------------------
           READ MIGRATION
        ------------------------------------------------- */

        const sql =
            fs.readFileSync(
                migrationFile,
                "utf8"
            );


        if (!sql.trim()) {
            throw new Error(
                "Migration file is empty."
            );
        }


        /* -------------------------------------------------
           RUN MIGRATION
        ------------------------------------------------- */

        console.log(
            "Running migration:"
        );

        console.log(
            "001_adsgram_rewards.sql"
        );

        await client.query("BEGIN");

        try {
            await client.query(sql);

            await client.query("COMMIT");

        } catch (migrationError) {

            await client.query("ROLLBACK");

            throw migrationError;
        }


        /* -------------------------------------------------
           SUCCESS
        ------------------------------------------------- */

        console.log(
            "Migration completed successfully."
        );

        console.log(
            "AdsGram database fields are ready."
        );

        console.log(
            "========================================"
        );

    } catch (error) {

        console.error(
            "Migration failed:"
        );

        console.error(
            error.message
        );

        if (error.stack) {
            console.error(
                error.stack
            );
        }

        process.exitCode = 1;

    } finally {

        /* -------------------------------------------------
           CLOSE DATABASE CONNECTION
        ------------------------------------------------- */

        if (client) {
            try {
                await client.end();

                console.log(
                    "PostgreSQL connection closed."
                );

            } catch (closeError) {

                console.error(
                    "Failed to close PostgreSQL connection:"
                );

                console.error(
                    closeError.message
                );

                process.exitCode = 1;
            }
        }

        console.log(
            "========================================"
        );
    }
}


/* =========================================================
   START
========================================================= */

migrate();

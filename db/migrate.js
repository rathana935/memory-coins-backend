import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationFile = path.join(
    __dirname,
    "migrations",
    "001_adsgram_rewards.sql"
);

async function migrate() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,

        ssl:
            process.env.NODE_ENV === "production"
                ? { rejectUnauthorized: false }
                : false
    });

    try {
        console.log("========================================");
        console.log("Memory Coins Database Migration");
        console.log("========================================");

        console.log("Connecting to PostgreSQL...");

        await client.connect();

        console.log("PostgreSQL connected.");

        if (!fs.existsSync(migrationFile)) {
            throw new Error(
                `Migration file not found: ${migrationFile}`
            );
        }

        const sql = fs.readFileSync(
            migrationFile,
            "utf8"
        );

        console.log(
            "Running migration: 001_adsgram_rewards.sql"
        );

        await client.query(sql);

        console.log("Migration completed successfully.");
        console.log("AdsGram database fields are ready.");

    } catch (error) {
        console.error("Migration failed:");
        console.error(error);

        process.exitCode = 1;

    } finally {
        await client.end();

        console.log("PostgreSQL connection closed.");
        console.log("========================================");
    }
}

migrate();

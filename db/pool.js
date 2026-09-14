import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    max: 20,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000,

    ssl:
        process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : false
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
});

export default pool;

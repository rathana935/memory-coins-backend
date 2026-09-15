import pg from "pg";

const { Pool } = pg;


/* =========================================================
   ENVIRONMENT VALIDATION
========================================================= */

if (!process.env.DATABASE_URL) {
    throw new Error(
        "DATABASE_URL environment variable is missing."
    );
}


/* =========================================================
   DATABASE CONFIGURATION
========================================================= */

const isProduction =
    process.env.NODE_ENV === "production";


const maxConnections =
    Number(
        process.env.DB_POOL_MAX || 20
    );


const idleTimeoutMillis =
    Number(
        process.env.DB_IDLE_TIMEOUT_MS || 30000
    );


const connectionTimeoutMillis =
    Number(
        process.env.DB_CONNECTION_TIMEOUT_MS || 10000
    );


/* =========================================================
   POSTGRESQL CONNECTION POOL
========================================================= */

const pool = new Pool({

    connectionString:
        process.env.DATABASE_URL,

    max:
        maxConnections,

    idleTimeoutMillis:
        idleTimeoutMillis,

    connectionTimeoutMillis:
        connectionTimeoutMillis,

    ssl:
        isProduction
            ? {
                rejectUnauthorized: false
            }
            : false
});


/* =========================================================
   POOL ERROR HANDLER
========================================================= */

pool.on(
    "error",
    (error) => {

        console.error(
            "Unexpected PostgreSQL pool error:",
            error
        );
    }
);


/* =========================================================
   EXPORT
========================================================= */

export default pool;

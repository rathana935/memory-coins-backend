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
   ENVIRONMENT
========================================================= */

const isProduction =
    process.env.NODE_ENV === "production";


/* =========================================================
   SAFE NUMBER HELPER
========================================================= */

function getPositiveInteger(
    value,
    fallback
) {

    const number = Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
        return fallback;
    }

    return Math.floor(number);
}


/* =========================================================
   DATABASE CONFIGURATION
========================================================= */

const maxConnections =
    getPositiveInteger(
        process.env.DB_POOL_MAX,
        10
    );

const idleTimeoutMillis =
    getPositiveInteger(
        process.env.DB_IDLE_TIMEOUT_MS,
        30000
    );

const connectionTimeoutMillis =
    getPositiveInteger(
        process.env.DB_CONNECTION_TIMEOUT_MS,
        10000
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

    /*
       Render PostgreSQL uses SSL in production.
       rejectUnauthorized:false is commonly required
       for managed PostgreSQL connections.
    */

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
   DATABASE CONNECTION TEST
========================================================= */

export async function testDatabaseConnection() {

    const client =
        await pool.connect();

    try {

        await client.query(
            "SELECT 1"
        );

        return true;

    } finally {

        client.release();

    }
}


/* =========================================================
   GRACEFUL DATABASE SHUTDOWN
========================================================= */

export async function closeDatabase() {

    await pool.end();

}


/* =========================================================
   EXPORT
========================================================= */

export default pool;

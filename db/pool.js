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

function getPositiveNumber(
    value,
    fallback
) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
        return fallback;
    }

    return number;
}


/* =========================================================
   DATABASE CONFIGURATION
========================================================= */

const maxConnections =
    Math.floor(
        getPositiveNumber(
            process.env.DB_POOL_MAX,
            10
        )
    );


const idleTimeoutMillis =
    Math.floor(
        getPositiveNumber(
            process.env.DB_IDLE_TIMEOUT_MS,
            30000
        )
    );


const connectionTimeoutMillis =
    Math.floor(
        getPositiveNumber(
            process.env.DB_CONNECTION_TIMEOUT_MS,
            10000
        )
    );


/* =========================================================
   POSTGRESQL CONNECTION POOL
========================================================= */

const pool =
    new Pool({

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
   OPTIONAL CONNECTION TEST
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
   EXPORT
========================================================= */

export default pool;

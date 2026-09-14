import "dotenv/config";

import express from "express";

import cors from "cors";

import helmet from "helmet";

import rateLimit from "express-rate-limit";

import pool from "./db/pool.js";

import authRoutes
    from "./routes/auth.js";


const app =
    express();


const PORT =
    Number(
        process.env.PORT || 3000
    );


/*
============================================================
SECURITY
============================================================
*/

app.use(
    helmet({
        crossOriginResourcePolicy: false
    })
);


app.use(
    cors({
        origin:
            process.env.FRONTEND_URL === "*"
                ? true
                : process.env.FRONTEND_URL,

        methods: [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
    })
);


app.use(
    express.json({
        limit: "100kb"
    })
);


app.use(
    express.urlencoded({
        extended: false,
        limit: "100kb"
    })
);


/*
============================================================
RATE LIMIT
============================================================
*/

const authLimiter =
    rateLimit({

        windowMs:
            15 * 60 * 1000,

        limit: 30,

        standardHeaders: true,

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many authentication requests. Please try again later."
        }

    });


/*
============================================================
HEALTH
============================================================
*/

app.get(
    "/health",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    "SELECT NOW() AS time"
                );


            res.json({

                success: true,

                server: "online",

                database: "online",

                time:
                    result.rows[0].time

            });


        } catch (error) {

            console.error(
                "Health check:",
                error
            );


            res.status(503).json({

                success: false,

                server: "online",

                database: "offline"

            });

        }

    }
);


/*
============================================================
AUTH
============================================================
*/

app.use(
    "/api/auth",
    authLimiter,
    authRoutes
);


/*
============================================================
404
============================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                "Endpoint not found"

        });

    }
);


/*
============================================================
GLOBAL ERROR
============================================================
*/

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Unhandled error:",
            error
        );


        res.status(500).json({

            success: false,

            error:
                "Internal server error"

        });

    }
);


/*
============================================================
START
============================================================
*/

const server =
    app.listen(
        PORT,
        () => {

            console.log(
                `Memory Coins API running on port ${PORT}`
            );

        }
    );


/*
============================================================
GRACEFUL SHUTDOWN
============================================================
*/

async function shutdown(
    signal
) {

    console.log(
        `${signal} received. Shutting down...`
    );


    server.close(
        async () => {

            await pool.end();

            process.exit(0);

        }
    );

}


process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

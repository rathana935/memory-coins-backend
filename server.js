import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import pool from "./db/pool.js";

import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import rewardsRoutes from "./routes/rewards.js";

import { requireAuth } from "./middleware/auth.js";

const app = express();

const PORT =
Number(
process.env.PORT || 3000
);

const FRONTEND_URL =
String(
process.env.FRONTEND_URL || ""
).trim();

/*

BASIC SETTINGS

*/

app.set(
"trust proxy",
1
);

/*

CORS

*/

const allowedOrigins =
new Set([
"https://rathana935.github.io"
]);

if (FRONTEND_URL) {

allowedOrigins.add(
    FRONTEND_URL.replace(
        /\/$/,
        ""
    )
);

}

const corsOptions = {

origin(
    origin,
    callback
) {

    /*
    ----------------------------------------------------
    Server-to-server / curl
    ----------------------------------------------------
    */

    if (!origin) {

        return callback(
            null,
            true
        );

    }


    /*
    ----------------------------------------------------
    GitHub Pages frontend
    ----------------------------------------------------
    */

    if (
        allowedOrigins.has(
            origin
        )
    ) {

        return callback(
            null,
            true
        );

    }


    /*
    ----------------------------------------------------
    Telegram WebView
    ----------------------------------------------------
    */

    if (
        origin === "null" ||
        origin.startsWith(
            "https://web.telegram.org"
        )
    ) {

        return callback(
            null,
            true
        );

    }


    /*
    ----------------------------------------------------
    Development mode
    ----------------------------------------------------
    */

    if (
        process.env.NODE_ENV !==
        "production"
    ) {

        return callback(
            null,
            true
        );

    }


    return callback(
        new Error(
            "CORS origin not allowed."
        )
    );

},


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
    "Accept",
    "Authorization",
    "X-Requested-With"

],


exposedHeaders: [

    "Content-Type"

],


credentials: false,


optionsSuccessStatus: 204,


maxAge: 86400

};

app.use(
cors(
corsOptions
)
);

/*

SECURITY HEADERS

*/

app.use(

helmet({

    crossOriginResourcePolicy:
        false

})

);

/*

BODY PARSER

*/

app.use(

express.json({

    limit:
        "100kb"

})

);

app.use(

express.urlencoded({

    extended:
        false,

    limit:
        "100kb"

})

);

/*

RATE LIMITING

*/

/*

GENERAL API LIMITER

*/

const apiLimiter =
rateLimit({

    windowMs:
        60 * 1000,

    limit:
        100,

    standardHeaders:
        true,

    legacyHeaders:
        false,

    message: {

        success:
            false,

        error:
            "Too many requests. Please try again later."

    }

});

/*

AUTH LIMITER

*/

const authLimiter =
rateLimit({

    windowMs:
        60 * 1000,

    limit:
        20,

    standardHeaders:
        true,

    legacyHeaders:
        false,

    message: {

        success:
            false,

        error:
            "Too many authentication requests. Please try again later."

    }

});

/*

GAME LIMITER

*/

const gameLimiter =
rateLimit({

    windowMs:
        60 * 1000,

    limit:
        60,

    standardHeaders:
        true,

    legacyHeaders:
        false,

    message: {

        success:
            false,

        error:
            "Too many game requests. Please try again later."

    }

});

/*

REWARDS LIMITER

Rewards are more sensitive than normal API requests.

This protects:

- Daily Bonus
- Lucky Roll
- Reward status

---

*/

const rewardsLimiter =
rateLimit({

    windowMs:
        60 * 1000,

    limit:
        30,

    standardHeaders:
        true,

    legacyHeaders:
        false,

    message: {

        success:
            false,

        error:
            "Too many reward requests. Please try again later."

    }

});

/*

APPLY GENERAL API LIMITER

*/

app.use(
"/api/",
apiLimiter
);

/*

ROOT

*/

app.get(
"/",
(req, res) => {

    return res.json({

        success:
            true,

        message:
            "Memory Coins backend is running 🚀",

        service:
            "memory-coins-backend",

        timestamp:
            new Date().toISOString()

    });

}

);

/*

HEALTH CHECK

*/

app.get(
"/api/health",
async (req, res) => {

    try {

        const result =
            await pool.query(
                "SELECT NOW() AS now"
            );


        return res.json({

            success:
                true,

            status:
                "ok",

            database:
                "connected",

            timestamp:
                result.rows[0].now

        });


    } catch (error) {

        console.error(
            "Health check error:",
            error
        );


        return res.status(
            500
        ).json({

            success:
                false,

            status:
                "error",

            database:
                "disconnected"

        });

    }

}

);

/*

AUTH ROUTES

POST /api/auth/telegram
GET  /api/auth/me
POST /api/auth/logout

Authentication itself does not require
a previous Bearer token.

============================================================
*/

app.use(
"/api/auth",
authLimiter,
authRoutes
);

/*

GAME ROUTES

GET  /api/game/status
POST /api/game/start
POST /api/game/complete

All game routes require authentication.

============================================================
*/

app.use(
"/api/game",
gameLimiter,
requireAuth,
gameRoutes
);

/*

REWARD ROUTES

POST /api/rewards/daily
POST /api/rewards/lucky-roll
GET  /api/rewards/status

All reward routes require authentication.

IMPORTANT:

The order here matters.

requireAuth runs before rewardsRoutes.

Therefore:

req.user
is available inside rewards.js.

============================================================
*/

app.use(
"/api/rewards",
rewardsLimiter,
requireAuth,
rewardsRoutes
);

/*

404 HANDLER

*/

app.use(
(req, res) => {

    return res.status(
        404
    ).json({

        success:
            false,

        error:
            "Route not found."

    });

}

);

/*

GLOBAL ERROR HANDLER

*/

app.use(
(
error,
req,
res,
next
) => {

    console.error(
        "Global error:",
        error
    );


    return res.status(
        500
    ).json({

        success:
            false,

        error:
            "Internal server error."

    });

}

);

/*

START SERVER

*/

const server =
app.listen(
PORT,
() => {

        console.log(
            `Memory Coins backend running on port ${PORT}`
        );

    }
);

/*

GRACEFUL SHUTDOWN

*/

async function shutdown(
signal
) {

console.log(
    `${signal} received. Shutting down...`
);


server.close(
    async () => {

        try {

            await pool.end();


            console.log(
                "PostgreSQL connection pool closed."
            );


            process.exit(
                0
            );


        } catch (error) {

            console.error(
                "Shutdown error:",
                error
            );


            process.exit(
                1
            );

        }

    }
);

}

process.on(
"SIGTERM",
() => shutdown(
"SIGTERM"
)
);

process.on(
"SIGINT",
() => shutdown(
"SIGINT"
)
);

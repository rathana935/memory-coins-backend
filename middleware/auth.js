import crypto from "crypto";

import pool from "../db/pool.js";


/* =========================================================
   HASH TOKEN
   Must exactly match routes/auth.js
========================================================= */

function hashToken(token) {

    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

}


/* =========================================================
   REQUIRE AUTH
   Matches POST /api/auth/telegram session creation
========================================================= */

export async function requireAuth(
    req,
    res,
    next
) {

    try {

        /* =================================================
           READ AUTHORIZATION HEADER
        ================================================= */

        const authorization =
            req.headers.authorization;


        if (
            typeof authorization !== "string"
        ) {

            return res.status(401).json({

                success: false,

                error:
                    "Authentication required"

            });

        }


        /* =================================================
           REQUIRE BEARER
        ================================================= */

        if (
            !authorization.startsWith("Bearer ")
        ) {

            return res.status(401).json({

                success: false,

                error:
                    "Authentication required"

            });

        }


        /* =================================================
           EXTRACT TOKEN
        ================================================= */

        const token =
            authorization
                .substring(7)
                .trim();


        if (!token) {

            return res.status(401).json({

                success: false,

                error:
                    "Authentication required"

            });

        }


        /* =================================================
           HASH TOKEN
           
           routes/auth.js stores:
           
           hashToken(sessionToken)
           
           in:
           
           auth_sessions.token_hash
        ================================================= */

        const tokenHash =
            hashToken(token);


        /* =================================================
           FIND SESSION
           
           This exactly matches the session created by
           routes/auth.js.
        ================================================= */

        const result =
            await pool.query(
                `
                SELECT
                    id,
                    user_id,
                    expires_at

                FROM auth_sessions

                WHERE token_hash = $1

                  AND expires_at > NOW()

                LIMIT 1
                `,
                [
                    tokenHash
                ]
            );


        /* =================================================
           SESSION NOT FOUND
        ================================================= */

        if (
            result.rows.length === 0
        ) {

            return res.status(401).json({

                success: false,

                error:
                    "Invalid or expired authentication token"

            });

        }


        /* =================================================
           SESSION
        ================================================= */

        const session =
            result.rows[0];


        /* =================================================
           ATTACH USER
           
           /api/auth/me does:
           
           const userId =
               req.user.user_id ||
               req.user.id;
           
           Therefore user_id is required.
        ================================================= */

        req.user = {

            user_id:
                session.user_id,

            id:
                session.user_id,

            session_id:
                session.id,

            expires_at:
                session.expires_at

        };


        /* =================================================
           CONTINUE
        ================================================= */

        return next();


    } catch (error) {

        console.error(
            "Authentication middleware error:",
            error
        );


        return res.status(500).json({

            success: false,

            error:
                "Authentication service unavailable"

        });

    }

}


/* =========================================================
   DEFAULT EXPORT
========================================================= */

export default requireAuth;

This now matches your route exactly

Your login route does:

const sessionToken =
    generateSessionToken();

const tokenHash =
    hashToken(sessionToken);

await client.query(
    `
    INSERT INTO auth_sessions
    (
        user_id,
        token_hash,
        expires_at,
        user_agent,
        ip_address
    )
    VALUES
    (
        $1,
        $2,
        NOW() + ($3 * INTERVAL '1 day'),
        $4,
        $5
    )
    `,
    [
        finalUser.id,
        tokenHash,
        sessionDays,
        ...
    ]
);

The middleware now reverses that exact process:

Authorization: Bearer sessionToken
              ↓
SHA-256(sessionToken)
              ↓
auth_sessions.token_hash
              ↓
expires_at > NOW()
              ↓
req.user.user_id
              ↓
/api/auth/me

And your "/api/auth/me" route:

const userId =
    req.user.user_id ||
    req.user.id;

will receive the correct "user_id".

One thing to verify after deployment: your frontend must send "Authorization: Bearer <data.authToken>" (or "<data.token>"). If it doesn't send that header, this middleware will correctly return “Authentication required.”

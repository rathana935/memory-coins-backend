import crypto from "crypto";
import pool from "../db/pool.js";


/* =========================================================
   TOKEN HASH
========================================================= */

function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}


/* =========================================================
   AUTHENTICATION MIDDLEWARE
========================================================= */

export async function requireAuth(req, res, next) {

    try {

        /* =====================================================
           READ AUTHORIZATION HEADER
        ===================================================== */

        const authorization =
            req.headers.authorization;


        if (
            typeof authorization !== "string"
        ) {

            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });

        }


        /* =====================================================
           CHECK BEARER FORMAT
        ===================================================== */

        if (
            !authorization.startsWith("Bearer ")
        ) {

            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });

        }


        /* =====================================================
           EXTRACT TOKEN
        ===================================================== */

        const token =
            authorization
                .substring(7)
                .trim();


        if (!token) {

            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });

        }


        /* =====================================================
           HASH TOKEN
        ===================================================== */

        const tokenHash =
            hashToken(token);


        /* =====================================================
           FIND VALID SESSION
        ===================================================== */

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


        /* =====================================================
           INVALID / EXPIRED TOKEN
        ===================================================== */

        if (
            result.rows.length === 0
        ) {

            return res.status(401).json({
                success: false,
                error:
                    "Invalid or expired authentication token"
            });

        }


        /* =====================================================
           SESSION
        ===================================================== */

        const session =
            result.rows[0];


        /* =====================================================
           ATTACH USER TO REQUEST
           
           Supports:
             req.user.user_id
             req.user.id
             req.user.session_id
             req.user.expires_at
        ===================================================== */

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


        /* =====================================================
           CONTINUE
        ===================================================== */

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

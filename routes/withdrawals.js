import express from "express";

import {
    createWithdrawal,
    getUserWithdrawals,
    getWithdrawal,
    WITHDRAWAL_CONFIG
} from "../services/withdrawals.js";

const router = express.Router();


/*
=========================================================
WITHDRAWALS
=========================================================

FaucetPay ONLY

Exchange:
10,000 coins = $1

Minimum:
2,500 coins
=========================================================
*/


/*
=========================================================
HELPER
=========================================================
*/

function getUserId(req) {

    return (
        req.user?.user_id ||
        req.user?.id ||
        null
    );

}


/*
=========================================================
GET /api/withdrawals/config

IMPORTANT:
This route MUST come BEFORE /:id

Otherwise:

GET /api/withdrawals/config

could be interpreted as:

GET /api/withdrawals/:id

=========================================================
*/

router.get(
    "/config",
    async (req, res) => {

        return res.json({

            success: true,

            provider:
                "faucetpay",

            exchangeRate: {

                coins:
                    WITHDRAWAL_CONFIG.COINS_PER_USD,

                usd:
                    1

            },

            minimumCoins:
                WITHDRAWAL_CONFIG.MIN_COINS

        });

    }
);


/*
=========================================================
POST /api/withdrawals

Request:

{
    "amountCoins": 2500,
    "provider": "faucetpay",
    "faucetpayEmail": "user@example.com"
}

=========================================================
*/

router.post(
    "/",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            /*
            -------------------------------------------------
            AUTHENTICATION
            -------------------------------------------------
            */

            if (!userId) {

                return res.status(401).json({

                    success: false,

                    error:
                        "AUTHENTICATION_REQUIRED",

                    message:
                        "Authentication required."

                });

            }


            /*
            -------------------------------------------------
            READ REQUEST
            -------------------------------------------------
            */

            const {
                amountCoins,
                provider,
                faucetpayEmail
            } = req.body || {};


            /*
            -------------------------------------------------
            FAUCETPAY ONLY
            -------------------------------------------------
            */

            if (
                typeof provider !== "string" ||
                provider.trim().toLowerCase() !==
                    "faucetpay"
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "INVALID_PROVIDER",

                    message:
                        "Only FaucetPay withdrawals are supported."

                });

            }


            /*
            -------------------------------------------------
            VALIDATE AMOUNT
            -------------------------------------------------
            */

            const amount =
                Number(amountCoins);


            if (
                !Number.isInteger(amount)
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "INVALID_AMOUNT",

                    message:
                        "Withdrawal amount must be a whole number of coins."

                });

            }


            if (
                amount <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "INVALID_AMOUNT",

                    message:
                        "Withdrawal amount must be greater than zero."

                });

            }


            /*
            -------------------------------------------------
            MINIMUM WITHDRAWAL
            -------------------------------------------------
            */

            if (
                amount <
                WITHDRAWAL_CONFIG.MIN_COINS
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "MINIMUM_WITHDRAWAL",

                    message:
                        `Minimum withdrawal is ${WITHDRAWAL_CONFIG.MIN_COINS.toLocaleString()} coins.`

                });

            }


            /*
            -------------------------------------------------
            VALIDATE FAUCETPAY EMAIL
            -------------------------------------------------
            */

            if (
                typeof faucetpayEmail !==
                    "string"
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "FAUCETPAY_EMAIL_REQUIRED",

                    message:
                        "FaucetPay email is required."

                });

            }


            const email =
                faucetpayEmail
                    .trim()
                    .toLowerCase();


            if (!email) {

                return res.status(400).json({

                    success: false,

                    error:
                        "FAUCETPAY_EMAIL_REQUIRED",

                    message:
                        "FaucetPay email is required."

                });

            }


            /*
            -------------------------------------------------
            EMAIL FORMAT
            -------------------------------------------------
            */

            const emailRegex =
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


            if (
                !emailRegex.test(email)
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "INVALID_FAUCETPAY_EMAIL",

                    message:
                        "Please enter a valid FaucetPay email."

                });

            }


            /*
            -------------------------------------------------
            CREATE WITHDRAWAL
            -------------------------------------------------
            */

            const withdrawal =
                await createWithdrawal({

                    userId,

                    amountCoins:
                        amount,

                    provider:
                        "faucetpay",

                    faucetpayEmail:
                        email

                });


            /*
            -------------------------------------------------
            SUCCESS
            -------------------------------------------------
            */

            return res.status(201).json({

                success: true,

                message:
                    "FaucetPay withdrawal request created.",

                withdrawal

            });


        } catch (error) {

            console.error(
                "Create withdrawal error:",
                error
            );


            return res.status(
                error.statusCode || 500
            ).json({

                success: false,

                error:
                    error.code ||
                    "WITHDRAWAL_CREATE_FAILED",

                message:
                    error.message ||
                    "Unable to create withdrawal."

            });

        }

    }
);


/*
=========================================================
GET /api/withdrawals

Get current user's withdrawal history.

Authentication is supplied by server.js:

app.use(
    "/api/withdrawals",
    requireAuth,
    withdrawalsRouter
);

=========================================================
*/

router.get(
    "/",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({

                    success: false,

                    error:
                        "AUTHENTICATION_REQUIRED",

                    message:
                        "Authentication required."

                });

            }


            /*
            -------------------------------------------------
            LIMIT
            -------------------------------------------------
            */

            let limit =
                Number.parseInt(
                    req.query.limit,
                    10
                );


            if (
                !Number.isInteger(limit)
            ) {

                limit = 50;

            }


            limit =
                Math.min(
                    Math.max(limit, 1),
                    100
                );


            /*
            -------------------------------------------------
            OFFSET
            -------------------------------------------------
            */

            let offset =
                Number.parseInt(
                    req.query.offset,
                    10
                );


            if (
                !Number.isInteger(offset) ||
                offset < 0
            ) {

                offset = 0;

            }


            /*
            -------------------------------------------------
            GET HISTORY
            -------------------------------------------------
            */

            const withdrawals =
                await getUserWithdrawals(

                    userId,

                    limit,

                    offset

                );


            return res.json({

                success: true,

                withdrawals

            });


        } catch (error) {

            console.error(
                "Get withdrawals error:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    "WITHDRAWALS_LOAD_FAILED",

                message:
                    error.message ||
                    "Unable to load withdrawals."

            });

        }

    }
);


/*
=========================================================
GET /api/withdrawals/:id

Get ONE withdrawal belonging to the
currently authenticated user.

=========================================================
*/

router.get(
    "/:id",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({

                    success: false,

                    error:
                        "AUTHENTICATION_REQUIRED",

                    message:
                        "Authentication required."

                });

            }


            /*
            -------------------------------------------------
            VALIDATE ID
            -------------------------------------------------
            */

            const withdrawalId =
                String(
                    req.params.id || ""
                ).trim();


            if (!withdrawalId) {

                return res.status(400).json({

                    success: false,

                    error:
                        "INVALID_WITHDRAWAL_ID",

                    message:
                        "Withdrawal ID is required."

                });

            }


            /*
            -------------------------------------------------
            GET WITHDRAWAL
            -------------------------------------------------
            */

            const withdrawal =
                await getWithdrawal(

                    withdrawalId,

                    userId

                );


            /*
            -------------------------------------------------
            NOT FOUND
            -------------------------------------------------
            */

            if (!withdrawal) {

                return res.status(404).json({

                    success: false,

                    error:
                        "WITHDRAWAL_NOT_FOUND",

                    message:
                        "Withdrawal not found."

                });

            }


            /*
            -------------------------------------------------
            SUCCESS
            -------------------------------------------------
            */

            return res.json({

                success: true,

                withdrawal

            });


        } catch (error) {

            console.error(
                "Get withdrawal error:",
                error
            );


            return res.status(
                error.statusCode || 500
            ).json({

                success: false,

                error:
                    error.code ||
                    "WITHDRAWAL_LOAD_FAILED",

                message:
                    error.message ||
                    "Unable to load withdrawal."

            });

        }

    }
);


export default router;

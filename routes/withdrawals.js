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
CONFIG
=========================================================
*/

const PROVIDER = "faucetpay";


/*
=========================================================
HELPERS
=========================================================
*/

function getUserId(req) {

    return (
        req.user?.user_id ||
        req.user?.id ||
        null
    );

}


function isValidUUID(value) {

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);

}


function sendError(
    res,
    statusCode,
    error,
    message
) {

    return res.status(statusCode).json({

        success: false,

        error,

        message

    });

}


/*
=========================================================
GET /api/withdrawals/config

Public configuration endpoint.

IMPORTANT:
Must come before /:id.
=========================================================
*/

router.get(
    "/config",
    async (req, res) => {

        return res.json({

            success: true,

            provider: PROVIDER,

            exchangeRate: {

                coins:
                    WITHDRAWAL_CONFIG.COINS_PER_USD,

                usd: 1

            },

            minimumCoins:
                WITHDRAWAL_CONFIG.MIN_COINS

        });

    }
);


/*
=========================================================
POST /api/withdrawals

Create withdrawal request.

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

                return sendError(
                    res,
                    401,
                    "AUTHENTICATION_REQUIRED",
                    "Authentication required."
                );

            }


            /*
            -------------------------------------------------
            REQUEST BODY
            -------------------------------------------------
            */

            const {
                amountCoins,
                provider,
                faucetpayEmail
            } = req.body || {};


            /*
            -------------------------------------------------
            PROVIDER
            -------------------------------------------------
            */

            if (
                typeof provider !== "string" ||
                provider.trim().toLowerCase() !== PROVIDER
            ) {

                return sendError(
                    res,
                    400,
                    "INVALID_PROVIDER",
                    "Only FaucetPay withdrawals are supported."
                );

            }


            /*
            -------------------------------------------------
            AMOUNT
            -------------------------------------------------
            */

            const amount =
                Number(amountCoins);


            if (!Number.isSafeInteger(amount)) {

                return sendError(
                    res,
                    400,
                    "INVALID_AMOUNT",
                    "Withdrawal amount must be a whole number of coins."
                );

            }


            if (amount <= 0) {

                return sendError(
                    res,
                    400,
                    "INVALID_AMOUNT",
                    "Withdrawal amount must be greater than zero."
                );

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

                return sendError(
                    res,
                    400,
                    "MINIMUM_WITHDRAWAL",
                    `Minimum withdrawal is ${WITHDRAWAL_CONFIG.MIN_COINS.toLocaleString()} coins.`
                );

            }


            /*
            -------------------------------------------------
            FAUCETPAY EMAIL
            -------------------------------------------------
            */

            if (
                typeof faucetpayEmail !== "string"
            ) {

                return sendError(
                    res,
                    400,
                    "FAUCETPAY_EMAIL_REQUIRED",
                    "FaucetPay email is required."
                );

            }


            const email =
                faucetpayEmail
                    .trim()
                    .toLowerCase();


            if (!email) {

                return sendError(
                    res,
                    400,
                    "FAUCETPAY_EMAIL_REQUIRED",
                    "FaucetPay email is required."
                );

            }


            /*
            -------------------------------------------------
            BASIC EMAIL VALIDATION
            -------------------------------------------------
            */

            const emailRegex =
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


            if (!emailRegex.test(email)) {

                return sendError(
                    res,
                    400,
                    "INVALID_FAUCETPAY_EMAIL",
                    "Please enter a valid FaucetPay email."
                );

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
                        PROVIDER,

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
                Number(error.statusCode) || 500
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
=========================================================
*/

router.get(
    "/",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return sendError(
                    res,
                    401,
                    "AUTHENTICATION_REQUIRED",
                    "Authentication required."
                );

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


            if (!Number.isInteger(limit)) {

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
            LOAD HISTORY
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

Get one withdrawal belonging to
the authenticated user.
=========================================================
*/

router.get(
    "/:id",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return sendError(
                    res,
                    401,
                    "AUTHENTICATION_REQUIRED",
                    "Authentication required."
                );

            }


            /*
            -------------------------------------------------
            VALIDATE UUID
            -------------------------------------------------
            */

            const withdrawalId =
                String(
                    req.params.id || ""
                ).trim();


            if (
                !isValidUUID(withdrawalId)
            ) {

                return sendError(
                    res,
                    400,
                    "INVALID_WITHDRAWAL_ID",
                    "Invalid withdrawal ID."
                );

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

                return sendError(
                    res,
                    404,
                    "WITHDRAWAL_NOT_FOUND",
                    "Withdrawal not found."
                );

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
                Number(error.statusCode) || 500
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

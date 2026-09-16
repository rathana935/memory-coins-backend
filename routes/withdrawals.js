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
FaucetPay ONLY

Exchange:
10,000 coins = $1

Minimum:
2,500 coins
=========================================================
*/


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

router.post("/", async (req, res) => {
  try {

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const {
      amountCoins,
      provider,
      faucetpayEmail
    } = req.body;


    /*
    -----------------------------------------------------
    FaucetPay ONLY
    -----------------------------------------------------
    */

    if (provider !== "faucetpay") {
      return res.status(400).json({
        success: false,
        message: "Only FaucetPay withdrawals are supported."
      });
    }


    /*
    -----------------------------------------------------
    Validate amount
    -----------------------------------------------------
    */

    const amount = Number(amountCoins);

    if (!Number.isInteger(amount)) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal amount must be a whole number of coins."
      });
    }


    if (amount < WITHDRAWAL_CONFIG.MIN_COINS) {
      return res.status(400).json({
        success: false,
        message:
          `Minimum withdrawal is ${WITHDRAWAL_CONFIG.MIN_COINS.toLocaleString()} coins.`
      });
    }


    /*
    -----------------------------------------------------
    Validate FaucetPay email
    -----------------------------------------------------
    */

    if (
      typeof faucetpayEmail !== "string" ||
      !faucetpayEmail.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "FaucetPay email is required."
      });
    }

    const email = faucetpayEmail.trim().toLowerCase();

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid FaucetPay email."
      });
    }


    /*
    -----------------------------------------------------
    Create withdrawal
    -----------------------------------------------------
    */

    const withdrawal = await createWithdrawal({
      userId,
      amountCoins: amount,
      provider: "faucetpay",
      faucetpayEmail: email
    });


    /*
    -----------------------------------------------------
    Response
    -----------------------------------------------------
    */

    return res.status(201).json({
      success: true,
      message: "FaucetPay withdrawal request created.",
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
      message:
        error.message ||
        "Unable to create withdrawal."
    });
  }
});


/*
=========================================================
GET /api/withdrawals

Get current user's withdrawal history.
=========================================================
*/

router.get("/", async (req, res) => {
  try {

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const limit = Math.min(
      Math.max(
        Number(req.query.limit) || 50,
        1
      ),
      100
    );

    const offset = Math.max(
      Number(req.query.offset) || 0,
      0
    );


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
      message:
        error.message ||
        "Unable to load withdrawals."
    });
  }
});


/*
=========================================================
GET /api/withdrawals/:id

Get one withdrawal belonging to current user.
=========================================================
*/

router.get("/:id", async (req, res) => {
  try {

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }


    const withdrawal =
      await getWithdrawal(
        req.params.id,
        userId
      );


    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal not found."
      });
    }


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
      message:
        error.message ||
        "Unable to load withdrawal."
    });
  }
});


/*
=========================================================
GET /api/withdrawals/config

Public withdrawal configuration.
=========================================================
*/

router.get("/config", async (req, res) => {

  return res.json({
    success: true,

    provider: "faucetpay",

    exchangeRate: {
      coins: WITHDRAWAL_CONFIG.COINS_PER_USD,
      usd: 1
    },

    minimumCoins:
      WITHDRAWAL_CONFIG.MIN_COINS
  });

});


export default router;

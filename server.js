require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const nodemailer = require("nodemailer");

const {
  hasReachedLimit,
  addRegistration,
  findByReference,
  updateRegistration
} = require("./registration-store");

const app = express();
const PORT = process.env.PORT || 3000;
const REGISTRATION_AMOUNT = 380000;

const mailer =
  process.env.SMTP_USER && process.env.SMTP_PASS
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      })
    : null;

async function sendRegistrationEmail(registration, payment) {
  if (!mailer || !process.env.NOTIFICATION_EMAIL) {
    console.log("Email notification skipped: SMTP not configured.");
    return;
  }

  await mailer.sendMail({
    from: `"CMDA-UUTH Rural Outreach" <${process.env.SMTP_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `New Paid Registration — ${registration.fullName}`,
    text: `
A new CMDA-UUTH Rural Outreach 2026 registration has been successfully paid.

Name: ${registration.fullName}
Phone: ${registration.phone}
Email: ${registration.email}
Gender: ${registration.gender}

Institution: ${registration.institution}
Level: ${registration.level}
Faculty: ${registration.faculty}
Department: ${registration.department}

CMDA Member: ${registration.cmda}
Previous Rural Outreach: ${registration.previousOutreach}
Unit: ${registration.unit}

Registration Fee: ₦3,800
Payment Reference: ${registration.reference}
Payment Channel: ${payment.channel || "N/A"}
Payment Status: SUCCESS
Paid At: ${payment.paid_at || new Date().toISOString()}
`
  });
}

async function completePayment(reference, payment) {
  const registration = await findByReference(reference);

  if (!registration) {
    return {
      success: false,
      reason: "registration_not_found"
    };
  }

  if (
    payment.status !== "success" ||
    payment.reference !== reference ||
    payment.amount !== REGISTRATION_AMOUNT ||
    payment.currency !== "NGN" ||
    payment.customer?.email?.toLowerCase() !== registration.email
  ) {
    return {
      success: false,
      reason: "payment_validation_failed"
    };
  }

  if (registration.paymentStatus === "success") {
    return {
      success: true,
      registration,
      alreadyCompleted: true
    };
  }

  const updated = await updateRegistration(registration.id, {
    paymentStatus: "success",
    paidAt: payment.paid_at || new Date().toISOString(),
    paymentChannel: payment.channel || null,
    paystackTransactionId: payment.id,
    paymentReference: payment.reference,
    paymentAmount: payment.amount,
    paymentCurrency: payment.currency
  });

  try {
    await sendRegistrationEmail(updated, payment);
  } catch (error) {
    console.error(
      "Notification email failed:",
      error.message
    );
  }

  return {
    success: true,
    registration: updated
  };
}

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public-static")));
app.use("/registration", express.static(path.join(__dirname, "public")));

app.get("/api/registration-status", async (req, res) => {
  try {
    res.json({
      open: !(await hasReachedLimit())
    });
  } catch (error) {
    console.error("Registration status error:", error.message);

    res.status(500).json({
      open: false,
      message: "Registration status unavailable."
    });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    if (await hasReachedLimit()) {
      return res.status(403).json({
        success: false,
        message: "Registration is currently closed."
      });
    }

    const {
      fullName,
      phone,
      email,
      gender,
      institution,
      level,
      faculty,
      department,
      cmda,
      previousOutreach,
      unit
    } = req.body;

    if (
      !fullName ||
      !phone ||
      !email ||
      !gender ||
      !institution ||
      !level ||
      !faculty ||
      !department ||
      !cmda ||
      !previousOutreach ||
      !unit
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields."
      });
    }


    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message: "Payment system is not configured."
      });
    }

    const registration = {
      id: crypto.randomUUID(),
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      gender,
      institution: institution.trim(),
      level,
      faculty: faculty.trim(),
      department: department.trim(),
      cmda,
      previousOutreach,
      unit,
      paymentStatus: "pending",
      reference: null,
      createdAt: new Date().toISOString()
    };

    const savedRegistration = await addRegistration(registration);

    const reference = `CMDA-${savedRegistration.id}`;

    const callbackUrl = process.env.APP_URL
      ? `${process.env.APP_URL}/payment/callback`
      : undefined;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: savedRegistration.email,
        amount: REGISTRATION_AMOUNT,
        currency: "NGN",
        reference,
        callback_url: callbackUrl,
        metadata: {
          registration_id: savedRegistration.id,
          full_name: savedRegistration.fullName,
          institution: savedRegistration.institution,
          unit: savedRegistration.unit
        }
      },
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    await updateRegistration(savedRegistration.id, {
      reference
    });

    res.json({
      success: true,
      authorizationUrl:
        response.data.data.authorization_url
    });

  } catch (error) {
    console.error(
      "Payment initialization error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to start payment. Please try again."
    });
  }
});

app.post("/api/paystack/webhook", async (req, res) => {
  try {
    const signature =
      req.headers["x-paystack-signature"];

    if (!signature || !req.rawBody) {
      return res.sendStatus(401);
    }

    const expectedSignature = crypto
      .createHmac(
        "sha512",
        process.env.PAYSTACK_SECRET_KEY
      )
      .update(req.rawBody)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    ) {
      return res.sendStatus(401);
    }

    res.sendStatus(200);

    const event = req.body;

    if (event.event === "charge.success") {
      const reference = event.data?.reference;

      if (reference) {
        await completePayment(
          reference,
          event.data
        );
      }
    }

  } catch (error) {
    console.error(
      "Webhook error:",
      error.message
    );

    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

app.get("/payment/callback", async (req, res) => {
  try {
    const reference = req.query.reference;

    if (!reference) {
      return res
        .status(400)
        .send("Payment reference missing.");
    }

    const registration =
      await findByReference(reference);

    if (!registration) {
      return res
        .status(404)
        .send("Registration not found.");
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const result = await completePayment(
      reference,
      response.data.data
    );

    if (!result.success) {
      return res.status(400).send(`
        <h1>Payment could not be verified</h1>
        <p>If money was deducted, please contact the outreach team.</p>
      `);
    }

    const whatsappLink =
      process.env.WHATSAPP_GROUP_LINK || "#";

    const safeName =
      registration.fullName
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport"
          content="width=device-width, initial-scale=1">
        <title>Registration Complete</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f7f2ed;
            font-family: Arial, sans-serif;
            color: #38242d;
            padding: 24px;
            box-sizing: border-box;
          }

          .card {
            max-width: 480px;
            width: 100%;
            background: white;
            padding: 40px 28px;
            border-radius: 24px;
            text-align: center;
            box-shadow:
              0 12px 40px rgba(56,36,45,.12);
          }

          h1 {
            margin-bottom: 12px;
          }

          p {
            line-height: 1.6;
          }

          a {
            display: inline-block;
            margin-top: 20px;
            padding: 14px 22px;
            border-radius: 12px;
            background: #8b3f58;
            color: white;
            text-decoration: none;
            font-weight: 700;
          }
        </style>
      </head>

      <body>
        <div class="card">
          <h1>Registration Complete</h1>

          <p>
            Thank you, ${safeName}.
            Your CMDA-UUTH Rural Outreach 2026
            registration and payment have been
            successfully confirmed.
          </p>

          <a href="${whatsappLink}">
            Join the WhatsApp Group
          </a>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error(
      "Payment verification error:",
      error.response?.data || error.message
    );

    res.status(500).send(`
      <h1>We could not confirm your payment yet.</h1>
      <p>
        If you were charged, please contact
        the outreach team.
      </p>
    `);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `CMDA Outreach site running at http://localhost:${PORT}`
  );
});

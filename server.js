require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const nodemailer = require("nodemailer");

const {
  hasReachedLimit,
  hasReachedUnitLimit,
  addRegistration,
  findByReference,
  updateRegistration,
  clearAllRegistrations
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

async function sendAdminRegistrationEmail(registration, payment) {
  const recipients = process.env.NOTIFICATION_EMAILS
    ? process.env.NOTIFICATION_EMAILS
        .split(",")
        .map(email => email.trim())
        .filter(Boolean)
    : process.env.NOTIFICATION_EMAIL
      ? [process.env.NOTIFICATION_EMAIL]
      : [];

  if (!mailer || recipients.length === 0) {
    console.log("Admin email notification skipped: SMTP not configured.");
    return;
  }

  await mailer.sendMail({
    from: `"CMDA-UUTH Rural Outreach" <${process.env.SMTP_USER}>`,
    to: recipients,
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

async function sendParticipantConfirmationEmail(registration, payment) {
  if (!mailer || !registration.email) {
    console.log("Participant confirmation email skipped: SMTP not configured.");
    return;
  }

  await mailer.sendMail({
    from: `"CMDA-UUTH Rural Outreach" <${process.env.SMTP_USER}>`,
    to: registration.email,
    subject: "CMDA-UUTH Rural Outreach 2026 — Registration Successful",
    text: `
Dear ${registration.fullName},

Your registration for the CMDA-UUTH Chapter Rural Outreach 2026 has been successfully completed.

Registration details:

Name: ${registration.fullName}
Unit: ${registration.unit}
Institution: ${registration.institution}
Level: ${registration.level}

Payment: ₦3,800
Payment Reference: ${registration.reference}
Payment Status: SUCCESS
Paid At: ${payment.paid_at || new Date().toISOString()}

Your payment has been successfully verified by Paystack, and your registration is confirmed.

Please keep this email for your records.

Thank you,
CMDA-UUTH Chapter
Rural Outreach 2026
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
    await Promise.all([
      sendAdminRegistrationEmail(updated, payment),
      sendParticipantConfirmationEmail(updated, payment)
    ]);
  } catch (error) {
    console.error(
      "Registration notification email failed:",
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

// Public landing page
app.use(express.static(path.join(__dirname, "public-static")));

// Registration form
app.use("/registration", express.static(path.join(__dirname, "public")));

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private-admin", "index.html"));
});

app.get("/api/registration-status", async (req, res) => {
  try {
    res.json({
      open: !(await hasReachedLimit()).reached
    });
  } catch (error) {
    console.error("Registration status error:", error.message);

    res.status(500).json({
      open: false,
      message: "Registration status unavailable."
    });
  }
});



function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="CMDA Outreach Admin"');
    return res.status(401).send("Admin login required.");
  }

  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");

  if (separator === -1) {
    res.set("WWW-Authenticate", 'Basic realm="CMDA Outreach Admin"');
    return res.status(401).send("Invalid admin credentials.");
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    res.set("WWW-Authenticate", 'Basic realm="CMDA Outreach Admin"');
    return res.status(401).send("Invalid admin credentials.");
  }

  next();
}

app.post("/api/admin/reset", requireAdmin, async (req, res) => {
  try {
    await clearAllRegistrations();

    res.json({
      success: true,
      message: "All registration records have been cleared."
    });
  } catch (error) {
    console.error("Admin reset error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to clear registration records."
    });
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const {
      MAX_REGISTRATIONS,
      UNIT_LIMITS,
      getSuccessfulRegistrations,
      hasReachedLimit,
      clearAllRegistrations
    } = require("./registration-store");

    const registrations = await getSuccessfulRegistrations();
    const overall = await hasReachedLimit();

    const units = {};

    for (const [unit, limit] of Object.entries(UNIT_LIMITS)) {
      const members = registrations
        .filter(registration => registration.unit === unit)
        .map(registration => ({
          name: registration.fullName,
          department: registration.department,
          level: registration.level
        }));

      const count = members.length;
      const remaining = Math.max(limit - count, 0);

      units[unit] = {
        count,
        limit,
        remaining,
        warning: remaining > 0 && remaining <= 3,
        full: remaining === 0,
        members
      };
    }

    res.json({
      success: true,
      overall: {
        count: overall.count,
        limit: MAX_REGISTRATIONS,
        remaining: overall.remaining,
        warning:
          overall.remaining > 0 &&
          overall.remaining <= 3,
        full: overall.remaining === 0
      },
      units,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Admin stats error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to load registration statistics."
    });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    if ((await hasReachedLimit()).reached) {
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


    const unitLimit = await hasReachedUnitLimit(unit);

    if (unitLimit.reached) {
      return res.status(403).json({
        success: false,
        message: `${unit} is already full. Please select another unit.`
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

import express from "express";
import path from "path";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";

// Local cache to keep track of Gmail emails dispatched per sender within a sliding window
// Allowed standard threshold is 27 sends within any 2 hours to avoid strict Google SMTP sensor block triggers.
const sendHistoryCache: { [senderEmail: string]: number[] } = {};

function cleanAndGetRollingCount(senderEmail: string): number {
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;
  
  if (!sendHistoryCache[senderEmail]) {
    sendHistoryCache[senderEmail] = [];
    return 0;
  }
  
  // Filter out timestamps older than 2 hours
  sendHistoryCache[senderEmail] = sendHistoryCache[senderEmail].filter(
    (timestamp) => now - timestamp < twoHoursMs
  );
  
  return sendHistoryCache[senderEmail].length;
}

function recordSendInCache(senderEmail: string) {
  if (!sendHistoryCache[senderEmail]) {
    sendHistoryCache[senderEmail] = [];
  }
  sendHistoryCache[senderEmail].push(Date.now());
}

const app = express();
app.use(express.json());

// Transporter construction helper
const getGmailTransporter = (
  senderEmail: string,
  appPassword: string,
  smtpMode: string = "auto"
) => {
  // If specific Gmail API service helper is requested
  if (smtpMode === "gmail") {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: appPassword,
      },
    });
  }

  // Auto Port or Specific Port Mode
  const port = smtpMode === "587" ? 587 : 465;
  const secure = port === 465;

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: port,
    secure: secure,
    auth: {
      user: senderEmail,
      pass: appPassword,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
};

// API Endpoint to check hourly/2-hourly remaining rolling limits
app.post("/api/check-limit", (req, res) => {
  const { senderEmail } = req.body;
  if (!senderEmail) {
    return res.status(400).json({ error: "Sender email is required." });
  }

  const activeCount = cleanAndGetRollingCount(senderEmail);
  const maxLimit = 27; // Safe custom 2-hour sliding limit to prevent Google lockouts
  const remaining = Math.max(0, maxLimit - activeCount);
  
  let nextResetTimeMs = 0;
  if (sendHistoryCache[senderEmail] && sendHistoryCache[senderEmail].length > 0) {
    // Expected oldest item expires precisely 2 hours after creation
    nextResetTimeMs = sendHistoryCache[senderEmail][0] + (2 * 60 * 60 * 1000);
  }

  res.json({
    sentInWindow: activeCount,
    remaining: remaining,
    allowed: remaining > 0,
    nextResetTimeMs: nextResetTimeMs,
  });
});

// API Endpoint to send simple, safe emails
app.post("/api/send-mail", async (req, res) => {
  const {
    senderName,
    senderEmail,
    appPassword,
    recipientEmail,
    subject,
    text,
    html,
    smtpMode,
  } = req.body;

  if (!senderEmail || !appPassword || !recipientEmail || !subject || !text) {
    return res.status(400).json({
      success: false,
      error: "Missing required inputs (sender email, app password, recipient, subject, or text).",
    });
  }

  // Enforce the 2-hour safety threshold rate limit
  const activeCount = cleanAndGetRollingCount(senderEmail);
  if (activeCount >= 27) {
    return res.status(429).json({
      success: false,
      error: "Gmail hourly account safety rate-limit reached. Please pause or wait to avoid Google SMTP temporary account suspensions.",
    });
  }

  try {
    const transporter = getGmailTransporter(senderEmail, appPassword, smtpMode);
    const displayName = senderName ? senderName.trim() : senderEmail.split("@")[0];

    // Clean and simple email bodies with absolutely no extra wrappers, links, footer, or security IDs
    const plainTextBody = text;
    const htmlBody = html;

    try {
      const info = await transporter.sendMail({
        from: `"${displayName}" <${senderEmail}>`,
        to: recipientEmail,
        subject: subject,
        text: plainTextBody,
        html: htmlBody,
        headers: {
          "X-Mailer": "Gmail Client Dispatch Utility",
          "X-Priority": "3", // Normal Priority
        },
      });

      // Record successful dispatch
      recordSendInCache(senderEmail);

      return res.json({
        success: true,
        messageId: info.messageId,
        response: info.response,
      });
    } catch (smtpErr: any) {
      console.error("SMTP Client error:", smtpErr);
      return res.status(500).json({
        success: false,
        error: smtpErr.message || "Failed authentication or mail drop rejection.",
      });
    }
  } catch (err: any) {
    console.error("Nodemailer setup failed:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Unknown mail transport initialization issue.",
    });
  }
});

// Serve frontend assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running beautifully on port ${PORT}`);
  });
}

startServer();

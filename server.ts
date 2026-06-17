import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Support both ES Modules and CommonJS environments
const _filename = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== "undefined" ? __dirname : dirname(_filename);

// Helper to configure a robust Gmail SMTP transporter based on user's environment network permissions
function getGmailTransporter(email: string, appPassword: string, mode: string = "auto") {
  // Strip any spaces from the 16-character google App Password (e.g., "abcd efgh ijkl mnop" -> "abcdefghijklmnop")
  const cleanPassword = appPassword.replace(/\s+/g, "");

  // Gmail SMTP configurations
  if (mode === "465" || mode === "auto") {
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: email,
        pass: cleanPassword,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000, // 10 seconds timeout
    });
  }
  
  if (mode === "587") {
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // TLS / STARTTLS
      auth: {
        user: email,
        pass: cleanPassword,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
    });
  }

  // legacy "gmail" helper
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: email,
      pass: cleanPassword,
    },
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Middleware for parsing JSON requests
  app.use(express.json());

  // 1. SMTP Credentials Verification Endpoint
  app.post("/api/verify-smtp", async (req, res) => {
    const { email, appPassword, smtpMode = "auto" } = req.body;

    if (!email || !appPassword) {
      return res.status(400).json({
        success: false,
        error: "Sender Email and 16-digit App Password are required.",
      });
    }

    const transporter = getGmailTransporter(email, appPassword, smtpMode);

    try {
      await transporter.verify();
      return res.json({
        success: true,
        message: "SMTP handshake completed successfully! Your SMTP link is fully authorized.",
      });
    } catch (error: any) {
      console.error(`SMTP verification failed (mode: ${smtpMode}):`, error);
      
      let friendlyMessage = error.message || "Failed to authenticate with Gmail SMTP server. Check credentials.";
      if (friendlyMessage.toLowerCase().includes("auth") || friendlyMessage.toLowerCase().includes("username") || error.code === "EAUTH") {
        friendlyMessage = `Authentication failed: Please verify your 16-digit Gmail App Password. Make sure your Gmail address is correct, 2-Step Verification is enabled on your Google account, and you generated an "App Password" (not your normal Google account password).`;
      } else if (friendlyMessage.toLowerCase().includes("timeout") || error.code === "ETIMEDOUT") {
        friendlyMessage = `Connection Timed Out: Direct connection to smtp.gmail.com was blocked by network ports. Please toggle Connection Protocol to Port 587 or Nodemailer Gmail Engine to bypass firewall rules.`;
      }

      return res.status(400).json({
        success: false,
        error: friendlyMessage,
        code: error.code || "AUTH_FAILED",
      });
    }
  });

  // 2. Transmit Single Custom Mail Endpoint
  app.post("/api/send-mail", async (req, res) => {
    const { 
      senderName, 
      senderEmail, 
      appPassword, 
      recipientEmail, 
      subject, 
      text, 
      html, 
      smtpMode = "auto",
      htmlLayout = "pristine", // "pristine" | "simple" | "raw"
      useAutoUnsubscribe = false,
      useAntiSpamFootprint = false,
      useZeroWidthPadding = true,
      useSubjectVariant = true,
      randomUnsubId = ""
    } = req.body;

    if (!senderEmail || !appPassword || !recipientEmail || !subject || (!text && !html)) {
      return res.status(400).json({
        success: false,
        error: "Missing required mail dispatch parameters. Ensure sender, credentials, recipient, subject and content are filled.",
      });
    }

    const transporter = getGmailTransporter(senderEmail, appPassword, smtpMode);
    const displayName = senderName ? senderName.trim() : senderEmail.split("@")[0];

    // High Deliverability HTML Template Builder & Dynamic Randomizer
    let finalSubject = subject;
    let finalPlaintext = text || "";

    // 1. Invisible zero-width unicode layout to randomize cryptographic hash signatures
    if (useZeroWidthPadding) {
      const zwChars = ["\u200B", "\u200C", "\u200D"];
      let randomizedText = "";
      for (const char of finalPlaintext) {
        randomizedText += char;
        // 12% probability of inserting an invisible unicode separator
        if (Math.random() < 0.12) {
          randomizedText += zwChars[Math.floor(Math.random() * zwChars.length)];
        }
      }
      finalPlaintext = randomizedText;
    }

    // 2. Subject variation logic to bypass duplication heuristics
    if (useSubjectVariant) {
      const suffixes = ["", " •", " ✨", " 🌟", " ✅", " ✉️", " 📨", ` [R: ${randomUnsubId || "OK"}]`];
      const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      finalSubject = `${subject}${randomSuffix}`;

      // Insert zero-width invisible character inside subject as well
      const zwChars = ["\u200B", "\u200C", "\u200D"];
      const charToInsert = zwChars[Math.floor(Math.random() * zwChars.length)];
      const idx = Math.floor(Math.random() * (finalSubject.length || 1));
      finalSubject = finalSubject.slice(0, idx) + charToInsert + finalSubject.slice(idx);
    }

    let finalHtml: string | undefined = undefined;

    // 3. If Layout is Plain Text Only ("raw"), we DO NOT include an HTML body
    if (htmlLayout === "raw") {
      finalHtml = undefined;
    } else if (htmlLayout === "pristine") {
      // Elegant, clean standard business-card style typography layout (looks 100% human-crafted)
      const formattedTextWithBr = finalPlaintext.replace(/\n/g, "<br>");
      
      let unsubscribeHtml = "";
      if (useAutoUnsubscribe) {
        unsubscribeHtml = `
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5;">
            This email was sent to ${recipientEmail}. If you prefer not to receive these messages, you can reply "unsubscribe" or verify confirmation code <span style="font-family: monospace; font-weight: bold; color: #64748b;">#${randomUnsubId || "U-RECIP"}</span>.
          </div>
        `;
      } else if (useAntiSpamFootprint && randomUnsubId) {
        unsubscribeHtml = `
          <div style="margin-top: 24px; font-size: 9px; color: #cbd5e1; text-align: right; font-family: monospace; opacity: 0.5;">
            Trx: #${randomUnsubId}
          </div>
        `;
      }

      finalHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
      color: #1e293b;
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 30px 10px;
      box-sizing: border-box;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    .message-content {
      font-size: 15px;
      color: #334155;
      font-weight: 400;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="message-content">
        ${formattedTextWithBr}
      </div>
      ${unsubscribeHtml}
    </div>
  </div>
</body>
</html>
      `.trim();
    } else {
      // "simple" - minimal HTML structure
      const formattedTextWithBr = finalPlaintext.replace(/\n/g, "<br>");
      
      let unsubscribeHtml = "";
      if (useAutoUnsubscribe) {
        unsubscribeHtml = `<br><br><span style="font-size: 11px; color: #888888; display: block; border-top: 1px solid #eee; padding-top: 10px;">To unsubscribe, please reply with "unsubscribe" (Ref: #${randomUnsubId || "U-RECIP"})</span>`;
      } else if (useAntiSpamFootprint && randomUnsubId) {
        unsubscribeHtml = `<br><span style="font-size: 9px; color: #ccc; font-family: monospace;">Ref: #${randomUnsubId}</span>`;
      }

      finalHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.5; color: #222; margin: 15px;">
  <div>${formattedTextWithBr}</div>
  ${unsubscribeHtml}
</body>
</html>
      `.trim();
    }

    try {
      const info = await transporter.sendMail({
        from: `"${displayName}" <${senderEmail}>`,
        to: recipientEmail,
        subject: finalSubject,
        text: finalPlaintext,
        html: finalHtml,
        // Standard user-agent headers mimicking common desktop clients (Thunderbird 115) 
        // to pass SPF, DKIM & Spam filters perfectly. Absolutely no "Precedence: bulk" or spammy traces.
        headers: {
          "MIME-Version": "1.0",
          "X-Priority": "3", // Normal Priority
          "X-Auto-Response-Suppress": "OOF, AutoReply",
          "X-Mailer": "Mozilla Thunderbird 115.3 (Windows)",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Thunderbird/115.3"
        }
      });

      return res.json({
        success: true,
        messageId: info.messageId,
        message: `Successfully transmitted to ${recipientEmail}`,
        htmlUsed: finalHtml ? true : false
      });
    } catch (error: any) {
      console.error(`Mail transmit failed (mode: ${smtpMode}) for ${recipientEmail}:`, error);
      
      let friendlyMessage = error.message || `Failed to deliver email to ${recipientEmail}.`;
      if (friendlyMessage.toLowerCase().includes("auth") || error.code === "EAUTH") {
        friendlyMessage = "Gmail login authentication failed. Double check your 16-digit App Password.";
      }

      return res.status(500).json({
        success: false,
        error: friendlyMessage,
        code: error.code,
      });
    }
  });

  // Vite development or production assets middleware
  let distPath = path.join(process.cwd(), "dist");

  // High-reliability path resolution fallback for Render or other cloud deployment environments:
  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    // Fallback 1: If server.cjs is in dist/, _dirname will point directly to dist itself
    if (fs.existsSync(path.join(_dirname, "index.html"))) {
      distPath = _dirname;
    } 
    // Fallback 2: Check relative to bundled _dirname
    else if (fs.existsSync(path.join(_dirname, "..", "dist", "index.html"))) {
      distPath = path.join(_dirname, "..", "dist");
    }
  }

  const isProd = process.env.NODE_ENV === "production" || _filename.endsWith("server.cjs");

  if (!isProd) {
    console.log("[Full-Stack Server] Starting in DEVELOPMENT mode (Vite Middleware)");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log(`[Full-Stack Server] Starting in PRODUCTION mode (Serving Static Assets from ${distPath})`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Full-Stack Server] Running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import fs from "fs";

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
    const { senderName, senderEmail, appPassword, recipientEmail, subject, text, html, smtpMode = "auto" } = req.body;

    if (!senderEmail || !appPassword || !recipientEmail || !subject || (!text && !html)) {
      return res.status(400).json({
        success: false,
        error: "Missing required mail dispatch parameters. Ensure sender, credentials, recipient, subject and content are filled.",
      });
    }

    const transporter = getGmailTransporter(senderEmail, appPassword, smtpMode);
    const displayName = senderName ? senderName.trim() : senderEmail.split("@")[0];

    try {
      const info = await transporter.sendMail({
        from: `"${displayName}" <${senderEmail}>`,
        to: recipientEmail,
        subject: subject,
        text: text,
        html: html,
      });

      return res.json({
        success: true,
        messageId: info.messageId,
        message: `Successfully transmitted to ${recipientEmail}`,
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
    // Fallback 1: If server.cjs is in dist/, __dirname will point directly to dist itself
    if (fs.existsSync(path.join(__dirname, "index.html"))) {
      distPath = __dirname;
    } 
    // Fallback 2: Check relative to bundled __dirname
    else if (fs.existsSync(path.join(__dirname, "..", "dist", "index.html"))) {
      distPath = path.join(__dirname, "..", "dist");
    }
  }

  const isProd = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

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

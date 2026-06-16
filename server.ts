// /server.ts (मुख्य मेल डिस्पैच लॉजिक)

app.post("/api/send-mail", async (req: express.Request, res: express.Response): Promise<any> => {
  const { senderEmail, appPassword, senderName, recipientEmail, subject, text, html, smtpMode } = req.body;

  if (!senderEmail || !appPassword || !recipientEmail || !subject || !text) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Gmail ट्रांसपोर्टर कॉन्फ़िगरेशन
  const transporter = getGmailTransporter(senderEmail, appPassword, smtpMode);
  const displayName = senderName ? senderName.trim() : senderEmail.split("@")[0];

  // 1. प्रति ईमेल अद्वितीय संदर्भ ट्रैकिंग कोड जेनरेट करें 
  const uniqueHash = Math.random().toString(36).substring(2, 8).toUpperCase();
  const securityId = `MSG-${uniqueHash}`;

  // 2. उच्च इनबॉक्स डिलीवरी के लिए मानक ऑप्ट-आउट पाद लेख के साथ सादा पाठ
  const plainTextWithFooter = `${text}\n\n---\nRef Code: ${securityId}\nThis email was sent by "${displayName}" <${senderEmail}> to ${recipientEmail}.\nIf you do not wish to receive future communications, please reply back with "UNSUBSCRIBE" to opt-out.`;

  // 3. सुंदर और अनुपालन-सुरक्षित मोबाइल-रिस्पॉन्सिव HTML रैपर
  const htmlWithWrapperAndFooter = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px 16px; background-color: #ffffff;">
      <div style="margin-bottom: 24px; padding-bottom: 12px;">
        ${html}
      </div>
      <div style="margin-top: 36px; border-top: 1px solid #f1f5f9; padding-top: 16px; font-size: 12px; color: #64748b; line-height: 1.6;">
        <p style="margin: 0; color: #94a3b8;">Sent securely by <strong>${displayName}</strong> (${senderEmail}) to <strong>${recipientEmail}</strong>.</p>
        <p style="margin: 6px 0 0 0;">To opt-out from future mailings, simply reply to this email with the word <strong style="color: #6366f1;">"UNSUBSCRIBE"</strong>.</p>
        <p style="margin: 12px 0 0 0; font-family: monospace; color: #cbd5e1; font-size: 10px; letter-spacing: 0.05em;">Security Identifier: ${securityId}</p>
      </div>
    </div>
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: `"${displayName}" <${senderEmail}>`,
      to: recipientEmail,
      subject: subject,
      text: plainTextWithFooter,
      html: htmlWithWrapperAndFooter,
      headers: {
        "X-Mailer": "Gmail Client Dispatch Utility",
        "X-Priority": "3", // सामान्य प्राथमिकता
        "X-Auto-Response-Suppress": "OOF, AutoReply", // ऑटो-रिप्लाई और लूप से बचाव
        "Precedence": "bulk" // करियर डिलीवरी ऑप्टिमाइज़ेशन
      }
    });

    return res.json({
      success: true,
      messageId: info.messageId,
    });
  } catch (err: any) {
    console.error("Mailer Transport Error: ", err);
    return res.status(500).json({ error: err.message });
  }
});

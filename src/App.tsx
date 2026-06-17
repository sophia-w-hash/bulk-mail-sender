import React, { useState, useEffect, useMemo, useRef, ChangeEvent } from "react";
import { 
  Mail, 
  Send, 
  Settings, 
  Users, 
  CheckCircle2, 
  XCircle, 
  Play, 
  Pause, 
  Square, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  HelpCircle, 
  Cpu, 
  Info, 
  Clock, 
  Search, 
  FileSpreadsheet, 
  Terminal,
  Layers,
  LogOut,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Client {
  email: string;
  name: string;
  index: number;
}

interface LogEntry {
  id: string;
  recipient: string;
  name: string;
  subject: string;
  status: "success" | "failed" | "sending" | "pending";
  timestamp: string;
  error?: string;
}

// Helper to retrieve and clean active limits map
const getGmailLimitsMap = (): Record<string, number[]> => {
  const rawLimits = localStorage.getItem("bulk_sender_limits");
  if (!rawLimits) return {};
  try {
    return JSON.parse(rawLimits);
  } catch (e) {
    return {};
  }
};

// Check Gmail account limits: 27 emails within 2 rolling hours
const checkGmailLimit = (email: string): { allowed: boolean; count: number; nextResetTimeMs: number } => {
  if (!email) return { allowed: true, count: 0, nextResetTimeMs: 0 };
  const now = Date.now();
  const limitWindowMs = 2 * 60 * 60 * 1000; // 2 hours
  const limitsMap = getGmailLimitsMap();
  const key = email.toLowerCase().trim();
  
  const list = limitsMap[key] || [];
  // Filter only timestamps in the last 2 hours
  const activeSends = list.filter(ts => (now - ts) < limitWindowMs);
  
  // Save updated map to local storage
  limitsMap[key] = activeSends;
  localStorage.setItem("bulk_sender_limits", JSON.stringify(limitsMap));
  
  const count = activeSends.length;
  const allowed = count < 27;
  
  // Calculate oldest timestamp in the active list to determine when the next reset slot opens
  const oldestTs = activeSends.length > 0 ? Math.min(...activeSends) : 0;
  const nextResetTimeMs = oldestTs > 0 ? oldestTs + limitWindowMs : 0;
  
  return { allowed, count, nextResetTimeMs };
};

// Record a successful email dispatch
const recordGmailSend = (email: string) => {
  if (!email) return;
  const now = Date.now();
  const limitsMap = getGmailLimitsMap();
  const key = email.toLowerCase().trim();
  
  if (!limitsMap[key]) limitsMap[key] = [];
  limitsMap[key].push(now);
  
  localStorage.setItem("bulk_sender_limits", JSON.stringify(limitsMap));
};

export default function App() {
  // Launcher password states (passcode 6395)
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("bulk_app_auth") === "true" || localStorage.getItem("bulk_app_auth") === "true";
  });
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");

  // SMTP Config Local Persistence
  const [senderName, setSenderName] = useState(() => localStorage.getItem("bulk_sender_name") || "");
  const [senderEmail, setSenderEmail] = useState(() => localStorage.getItem("bulk_sender_email") || "");
  const [appPassword, setAppPassword] = useState(() => localStorage.getItem("bulk_smtp_pass") || "");
  const [smtpMode, setSmtpMode] = useState(() => localStorage.getItem("bulk_smtp_mode") || "auto");
  const [showPassword, setShowPassword] = useState(false);
  const [smtpVerified, setSmtpVerified] = useState<boolean | null>(null);
  const [verifyingSmtp, setVerifyingSmtp] = useState(false);
  const [smtpStatusMsg, setSmtpStatusMsg] = useState("");

  // Recipient States
  const [rawRecipients, setRawRecipients] = useState("");
  const [recipientFileHelp, setRecipientFileHelp] = useState("");

  // Mail Content States
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");

  // Sending Process / Queue States
  const [sendDelay, setSendDelay] = useState(5.0); // default 5.0 second delay between batches (10 emails per batch) for safe human-like intervals
  const [useJitter, setUseJitter] = useState(() => localStorage.getItem("bulk_use_jitter") === "true");
  const [sendingState, setSendingState] = useState<"idle" | "sending" | "paused">("idle");
  
  // Deliverability and Spam Protection States
  const [htmlLayout, setHtmlLayout] = useState<"pristine" | "simple" | "raw">(() => (localStorage.getItem("bulk_html_layout") as "pristine" | "simple" | "raw") || "raw"); // Default to raw (plain text) for direct high inbox-delivery TXT
  const [useAutoUnsubscribe, setUseAutoUnsubscribe] = useState(() => localStorage.getItem("bulk_use_unsubscribe") === "true"); // default false to avoid auto extra lines
  const [useAntiSpamFootprint, setUseAntiSpamFootprint] = useState(() => localStorage.getItem("bulk_use_footprint") === "true"); // default false to avoid auto extra lines
  const [useZeroWidthPadding, setUseZeroWidthPadding] = useState(() => localStorage.getItem("bulk_use_zero_width") !== "false"); // default true
  const [useSubjectVariant, setUseSubjectVariant] = useState(() => localStorage.getItem("bulk_use_subj_variant") !== "false"); // default true
  const [neutralizeSpamWords, setNeutralizeSpamWords] = useState(() => localStorage.getItem("bulk_neutralize_spam") !== "false"); // default true

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Sync deliverability states to local storage
  useEffect(() => {
    localStorage.setItem("bulk_html_layout", htmlLayout);
  }, [htmlLayout]);

  useEffect(() => {
    localStorage.setItem("bulk_use_unsubscribe", useAutoUnsubscribe ? "true" : "false");
  }, [useAutoUnsubscribe]);

  useEffect(() => {
    localStorage.setItem("bulk_use_footprint", useAntiSpamFootprint ? "true" : "false");
  }, [useAntiSpamFootprint]);

  useEffect(() => {
    localStorage.setItem("bulk_use_zero_width", useZeroWidthPadding ? "true" : "false");
  }, [useZeroWidthPadding]);

  useEffect(() => {
    localStorage.setItem("bulk_use_subj_variant", useSubjectVariant ? "true" : "false");
  }, [useSubjectVariant]);

  useEffect(() => {
    localStorage.setItem("bulk_neutralize_spam", neutralizeSpamWords ? "true" : "false");
  }, [neutralizeSpamWords]);

  // Mails Limit Modals
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [limitModalSender, setLimitModalSender] = useState("");
  const [limitModalResetTime, setLimitModalResetTime] = useState("");

  // Error Popup Dialogs
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorModalTitle, setErrorModalTitle] = useState("");
  const [errorModalMessage, setErrorModalMessage] = useState("");

  // Sync useJitter to localStorage
  useEffect(() => {
    localStorage.setItem("bulk_use_jitter", useJitter ? "true" : "false");
  }, [useJitter]);

  // Queue references
  const [currentIndex, setCurrentIndex] = useState(0);
  const isSendingRef = useRef<boolean>(false);
  const sendingStateRef = useRef<"idle" | "sending" | "paused">("idle");
  const activeTimersRef = useRef<Set<any>>(new Set());

  // Synchronize dynamic references for the loop effect
  useEffect(() => {
    sendingStateRef.current = sendingState;
    isSendingRef.current = sendingState === "sending";
  }, [sendingState]);

  // Save Config to LocalStorage
  useEffect(() => {
    localStorage.setItem("bulk_sender_name", senderName);
  }, [senderName]);

  useEffect(() => {
    localStorage.setItem("bulk_sender_email", senderEmail);
  }, [senderEmail]);

  useEffect(() => {
    localStorage.setItem("bulk_smtp_pass", appPassword);
  }, [appPassword]);

  useEffect(() => {
    localStorage.setItem("bulk_smtp_mode", smtpMode);
  }, [smtpMode]);

  // Auto Reset Verification status if credentials change
  useEffect(() => {
    setSmtpVerified(null);
    setSmtpStatusMsg("");
  }, [senderName, senderEmail, appPassword, smtpMode]);

  // Reset SMTP stats & Clear Input Cache (Logout)
  const handleClearSMTPConfig = () => {
    const confirmation = window.confirm("Are you sure you want to log out and clear all your SMTP details from this device?");
    if (!confirmation) return;

    setSenderName("");
    setSenderEmail("");
    setAppPassword("");
    setSmtpMode("auto");
    setSmtpVerified(null);
    setSmtpStatusMsg("");
    
    localStorage.removeItem("bulk_sender_name");
    localStorage.removeItem("bulk_sender_email");
    localStorage.removeItem("bulk_smtp_pass");
    localStorage.removeItem("bulk_smtp_mode");

    alert("Logged out successfully! Credentials have been wiped.");
  };

  // Recipient Parsing Logic
  const parsedRecipients = useMemo((): Client[] => {
    if (!rawRecipients.trim()) return [];
    
    return rawRecipients
      .split("\n")
      .map((line, idx) => {
        const cleaned = line.trim();
        if (!cleaned) return null;

        // Try comma split: Name, email
        if (cleaned.includes(",")) {
          const parts = cleaned.split(",");
          const name = parts[0]?.trim() || "";
          const email = parts[1]?.trim() || "";
          if (email.includes("@")) {
            return { name, email, index: idx };
          }
        }

        // Try clean email only
        if (cleaned.includes("@")) {
          const emailMatch = cleaned.match(/[^\s,;]+@[^\s,;]+/);
          if (emailMatch) {
            const email = emailMatch[0];
            const name = email.split("@")[0];
            return { name, email, index: idx };
          }
        }

        return null;
      })
      .filter((item): item is Client => item !== null);
  }, [rawRecipients]);

  // Spintax & Dynamic Content Generator Tools for Safe Inbox Delivery
  const parseSpintax = (str: string): string => {
    let output = str;
    // Matches {abc|def|xyz} patterns containing a pipe character
    const spintaxRegex = /\{([^{}|]+(?:\|[^{}|]+)+)\}/g;
    let limit = 0; // prevent absolute infinite loops
    while (spintaxRegex.test(output) && limit < 100) {
      output = output.replace(spintaxRegex, (match, choicesStr) => {
        const choices = choicesStr.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
      });
      limit++;
    }
    return output;
  };

  const renderTemplateFull = (template: string, clientName: string, clientEmail: string): string => {
    // 1. Process Spintax choices first (e.g. {Hi|Hello|Hey})
    let result = parseSpintax(template);
    
    // 2. Generate random 6-character hex/alphanumeric code
    const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // 3. Current Date & Time values
    const todayStr = new Date().toLocaleDateString('en-GB'); // "16/06/2026"
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false }); // "14:25:01"
    
    // 4. Perform direct clean standard token replacements
    result = result
      .replace(/{name}/g, clientName)
      .replace(/{email}/g, clientEmail)
      .replace(/{random_id}/g, randomHex)
      .replace(/{date}/g, todayStr)
      .replace(/{time}/g, timeStr);
      
    return result;
  };

  const applySpamBypassNeutralizer = (text: string): string => {
    const replaceMap: Record<string, string> = {
      "free": "f-r-e-e",
      "earn money": "e*a*r*n money",
      "make money": "m*a*k*e money",
      "cash": "ca$h",
      "millions": "mil-lions",
      "lottery": "lot-tery",
      "guaranteed": "guar-anteed",
      "100% free": "100% f-r-e-e",
      "click here": "cl*ck h*re",
      "income": "inc-ome",
      "usd": "U.S.D.",
      "gift card": "g*ft card",
      "work from home": "w*rk from h*me",
      "investment": "invest-ment",
      "get paid": "g*t p*id",
      "crypto": "cryp-to",
      "bitcoin": "bit-coin",
      "loan": "lo-an",
      "casino": "cas-ino",
      "jackpot": "jack-pot"
    };

    let result = text;
    Object.entries(replaceMap).forEach(([spamWord, bypassWord]) => {
      const regex = new RegExp(`\\b${spamWord}\\b`, "gi");
      result = result.replace(regex, bypassWord);
    });
    return result;
  };

  // Deliverability Spam Score Scanner Utility (Bypasses spam folders dynamically)
  const getSpamAnalysis = (subject: string, body: string) => {
    const SPAM_TRIGGER_WORDS = [
      "free", "earn money", "make money", "winner", "cash", "millions", "lottery",
      "guaranteed", "100% free", "click here", "income", "usd", "gift card", "work from home",
      "investment", "get paid", "crypto", "bitcoin", "loan", "viagra", "casino", "jackpot"
    ];

    const combined = `${subject.toLowerCase()} ${body.toLowerCase()}`;
    const wordsFound: string[] = [];
    
    SPAM_TRIGGER_WORDS.forEach(word => {
      // Find exact word or surrounded by spaces/punctuation
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(combined)) {
        wordsFound.push(word);
      }
    });

    const linkRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|net|in|biz|info|cc|co|xyz|me|gov|edu|us|uk|in|ca|au)\b/i;
    const hasLink = linkRegex.test(subject) || linkRegex.test(body);

    const hasPersonalizationInSubject = subject.includes("{name}") || subject.includes("{email}");
    const hasPersonalizationInBody = body.includes("{name}") || body.includes("{email}");
    const hasUniqueId = body.includes("{random_id}");

    let score = 100;
    const issues: string[] = [];

    if (wordsFound.length > 0) {
      score -= Math.min(wordsFound.length * 15, 45);
      issues.push(`Spam keywords detected: "${wordsFound.slice(0, 3).join(", ")}"`);
    }

    if (hasLink) {
      score -= 60;
      issues.push("⚠️ Links/URLs detected! (Mails containing links are blocked by search/anti-spam heuristics. Please remove all links and domains to landing directly in INBOX)");
    }

    if (!hasPersonalizationInSubject) {
      score -= 10;
      issues.push("Subject is not personalized (tip: add {name} to personalize subject)");
    }

    if (!hasPersonalizationInBody) {
      score -= 15;
      issues.push("Body lacks personalization elements (add {name} or {email})");
    }

    if (!hasUniqueId) {
      score -= 20;
      issues.push("No unique ID found (sending identical messages triggers spam folders. Add {random_id} tag)");
    }

    if (body.trim().length > 0 && body.trim().length < 50) {
      score -= 10;
      issues.push("Body text length is extremely short (under 50 chars looks suspicious)");
    }

    const finalScore = Math.max(10, score);
    let level: "good" | "medium" | "high" = "good";
    if (finalScore < 55) {
      level = "high";
    } else if (finalScore < 80) {
      level = "medium";
    }

    return { score: finalScore, level, issues, wordsFound, hasLink };
  };

  const getSpamKeywords = (text: string): string[] => {
    const SPAM_TRIGGER_WORDS = [
      "free", "earn money", "make money", "winner", "cash", "millions", "lottery",
      "guaranteed", "100% free", "click here", "income", "usd", "gift card", "work from home",
      "investment", "get paid", "crypto", "bitcoin", "loan", "viagra", "casino", "jackpot"
    ];
    const lower = text.toLowerCase();
    const found: string[] = [];
    SPAM_TRIGGER_WORDS.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(lower)) {
        found.push(word);
      }
    });

    const linkRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|net|in|biz|info|cc|co|xyz|me|gov|edu|us|uk|in|ca|au)\b/i;
    const matches = text.match(linkRegex);
    if (matches) {
      found.push(`Link/URL: "${matches[0].slice(0, 20)}${matches[0].length > 20 ? "..." : ""}"`);
    }

    return found;
  };

  const subjectSpamWords = useMemo(() => getSpamKeywords(subjectTemplate), [subjectTemplate]);
  const bodySpamWords = useMemo(() => getSpamKeywords(bodyTemplate), [bodyTemplate]);

  // Synchronize dynamic status logs automatically in real-time when idle
  useEffect(() => {
    if (sendingState === "idle") {
      setCurrentIndex(0);
      const list: LogEntry[] = parsedRecipients.map((cl, i) => ({
        id: `${cl.email}-${i}-${Date.now()}`,
        recipient: cl.email,
        name: cl.name,
        subject: subjectTemplate.replace(/{name}/g, cl.name).replace(/{email}/g, cl.email),
        status: "pending",
        timestamp: "Waiting...",
      }));
      setLogs(list);
    }
  }, [parsedRecipients, subjectTemplate, sendingState]);

  // Verify SMTP Connection
  const handleVerifySMTP = async () => {
    if (!senderEmail || !appPassword) {
      setSmtpVerified(false);
      setSmtpStatusMsg("Please fill both Sender Gmail and 16-digit App Password first.");
      return;
    }

    setVerifyingSmtp(true);
    setSmtpVerified(null);
    setSmtpStatusMsg(`Connecting via ${smtpMode === "auto" ? "Direct SSL (465)" : smtpMode}...`);

    try {
      const response = await fetch("/api/verify-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: senderEmail, appPassword, smtpMode }),
      });

      const data = await response.json();
      if (data.success) {
        setSmtpVerified(true);
        setSmtpStatusMsg(data.message);
      } else {
        setSmtpVerified(false);
        setSmtpStatusMsg(data.error || "Verification failed. Check your App Password or toggles.");
        
        // Dynamic credentials verification popup alert
        setErrorModalTitle("SMTP App Password Rejected");
        setErrorModalMessage(data.error || "Google security policy rejected this App Password. Normal login passwords will fail. Please make sure you generated a 16-digit App Password under your Google Account Security settings.");
        setErrorModalOpen(true);
      }
    } catch (err: any) {
      setSmtpVerified(false);
      setSmtpStatusMsg(err.message || "Failed to make verify network request. Check connection.");
      
      setErrorModalTitle("SMTP Port Connection Failed");
      setErrorModalMessage(err.message || "Connection was reset by peer. Make sure your internet connection is active and the backend container is running.");
      setErrorModalOpen(true);
    } finally {
      setVerifyingSmtp(false);
    }
  };

  // SMTP Connection Quick Checker
  const checkSmtpQuietly = async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/verify-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: senderEmail, appPassword, smtpMode }),
      });
      const data = await response.json();
      return !!data.success;
    } catch {
      return false;
    }
  };

  // Core Sending Queue Loops
  const startSendingQueue = async () => {
    if (!senderEmail || !appPassword) {
      alert("Please enter Sender Gmail and 16-digit App Password in the setup fields first.");
      return;
    }
    if (parsedRecipients.length === 0) {
      alert("No valid recipient emails found. Please provide a list of recipients.");
      return;
    }

    let startIndex = currentIndex;
    if (currentIndex >= parsedRecipients.length) {
      startIndex = 0;
      setCurrentIndex(0);
      setLogs((prev) => 
        prev.map((log) => ({ ...log, status: "pending", timestamp: "Waiting...", error: undefined }))
      );
    }

    setSendingState("sending");
    isSendingRef.current = true;

    const batchSize = 10;
    let nextIndexToProcess = startIndex;

    const processSingleItem = async (indexToProcess: number): Promise<boolean> => {
      // Ensure Gmail hourly dispatch limit of 27 per 2-hours is fully safe and enforced
      const limitStatus = checkGmailLimit(senderEmail);
      if (!limitStatus.allowed) {
        setSendingState("idle");
        isSendingRef.current = false;
        const resetTimeStr = limitStatus.nextResetTimeMs > 0 
          ? new Date(limitStatus.nextResetTimeMs).toLocaleTimeString() 
          : "in roughly 2 hours";
        
        setLimitModalSender(senderEmail);
        setLimitModalResetTime(resetTimeStr);
        setLimitModalOpen(true);
        return false;
      }

      const currentClient = parsedRecipients[indexToProcess];

      setLogs((prev) => 
        prev.map((log, idx) => 
          idx === indexToProcess ? { ...log, status: "sending", timestamp: "Sending..." } : log
        )
      );

      // Render templates with full safety spintax and unique variables!
      const customSubject = renderTemplateFull(subjectTemplate, currentClient.name, currentClient.email);
      let customBody = renderTemplateFull(bodyTemplate, currentClient.name, currentClient.email);

      // If Neutralize Spam Words is enabled, auto neutralize before dispatch
      if (neutralizeSpamWords) {
        customBody = applySpamBypassNeutralizer(customBody);
      }

      // Generate a unique transaction / unsubscribe footprint ID per recipient
      const randomUnsubId = Math.random().toString(36).substring(2, 8).toUpperCase();

      try {
        const response = await fetch("/api/send-mail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderName,
            senderEmail,
            appPassword,
            recipientEmail: currentClient.email,
            subject: customSubject,
            text: customBody,
            smtpMode,
            htmlLayout,
            useAutoUnsubscribe,
            useAntiSpamFootprint,
            useZeroWidthPadding,
            useSubjectVariant,
            randomUnsubId
          }),
        });

        const data = await response.json();

        if (data.success) {
          // Record secure successful send inside Gmail rolling limiter
          recordGmailSend(senderEmail);

          setLogs((prev) => 
            prev.map((log, idx) => 
              idx === indexToProcess 
                ? { 
                    ...log, 
                    status: "success", 
                    subject: customSubject, // record the exact parsed subject sent to this user in logs
                    timestamp: new Date().toLocaleTimeString(), 
                    error: undefined 
                  } 
                : log
            )
          );
          return true;
        } else {
          // Stop dispatch loop
          setSendingState("idle");
          isSendingRef.current = false;

          setLogs((prev) => 
            prev.map((log, idx) => 
              idx === indexToProcess 
                ? { 
                    ...log, 
                    status: "failed", 
                    subject: customSubject,
                    timestamp: new Date().toLocaleTimeString(),
                    error: data.error || "Rejected by Google SMTP server." 
                  } 
                : log
            )
          );

          setErrorModalTitle("SMTP Transmission Error");
          setErrorModalMessage(data.error || "Google SMTP server rejected the login. Please confirm your 16-digit Gmail App Password matches exactly.");
          setErrorModalOpen(true);
          return false;
        }
      } catch (err: any) {
        // Stop dispatch loop
        setSendingState("idle");
        isSendingRef.current = false;

        setLogs((prev) => 
          prev.map((log, idx) => 
            idx === indexToProcess 
              ? { 
                  ...log, 
                  status: "failed", 
                  subject: customSubject,
                  timestamp: new Date().toLocaleTimeString(),
                  error: err.message || "Failed network connection to mail server." 
                } 
              : log
          )
        );

        setErrorModalTitle("Dispatch Connection Failed");
        setErrorModalMessage(err.message || "Could not make a secure request to the outbound mail server. Check backend status.");
        setErrorModalOpen(true);
        return false;
      }
    };

    const runBatchDispatch = async () => {
      while (isSendingRef.current && nextIndexToProcess < parsedRecipients.length) {
        const currentBatch: number[] = [];
        for (let i = 0; i < batchSize && (nextIndexToProcess + i) < parsedRecipients.length; i++) {
          currentBatch.push(nextIndexToProcess + i);
        }

        // Parallel trigger for the entire batch
        const batchPromises = currentBatch.map((index) => processSingleItem(index));

        // Advance the master index
        nextIndexToProcess += currentBatch.length;
        setCurrentIndex(nextIndexToProcess);

        // Wait for all messages in the batch to be processed
        const results = await Promise.all(batchPromises);

        // If any sending process failed or was aborted, stop
        const allOk = results.every((ok) => ok === true);
        if (!allOk || !isSendingRef.current) {
          break;
        }

        // Apply delay between batches if there is more to process
        if (nextIndexToProcess < parsedRecipients.length && isSendingRef.current) {
          let finalDelayMs = sendDelay * 1000;
          if (useJitter) {
            const randomModifier = (Math.random() * 4 - 1.5) * 1000;
            finalDelayMs = Math.max(100, finalDelayMs + randomModifier);
          }

          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              activeTimersRef.current.delete(timer);
              resolve();
            }, finalDelayMs);
            activeTimersRef.current.add(timer);
          });
        }
      }

      setSendingState("idle");
      if (nextIndexToProcess >= parsedRecipients.length && isSendingRef.current) {
        alert("🎉 Done! All bulk emails processed successfully.");
      }
      isSendingRef.current = false;
    };

    runBatchDispatch();
  };

  const handlePauseSending = () => {
    isSendingRef.current = false;
    setSendingState("paused");
    activeTimersRef.current.forEach((timer) => clearTimeout(timer));
    activeTimersRef.current.clear();
  };

  const handleStopSending = () => {
    isSendingRef.current = false;
    setSendingState("idle");
    setCurrentIndex(0);
    activeTimersRef.current.forEach((timer) => clearTimeout(timer));
    activeTimersRef.current.clear();
  };

  // Upload custom dynamic list of clients (.txt or .csv files)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setRawRecipients(text);
        setRecipientFileHelp(`Successfully loaded CSV file (${file.name})!`);
      }
    };
    reader.readAsText(file);
  };

  // Formatted statistics to highlight sending outcomes
  const stats = useMemo(() => {
    const total = parsedRecipients.length;
    const sentSuccess = logs.filter(l => l.status === "success").length;
    const sentFailed = logs.filter(l => l.status === "failed").length;
    const pendingCount = logs.filter(l => l.status === "pending" || l.status === "sending").length;
    const progressPercent = total > 0 ? Math.round(((total - pendingCount) / total) * 100) : 0;
    
    return {
      total,
      sentSuccess,
      sentFailed,
      pendingCount,
      progressPercent
    };
  }, [logs, parsedRecipients]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-slate-800 border border-slate-700/80 rounded-2xl p-6 text-center space-y-6 shadow-2xl relative overflow-hidden"
        >
          {/* Decorative ambient orb */}
          <div className="absolute -top-12 -left-12 w-24 h-24 bg-indigo-500/20 rounded-full blur-xl" />
          <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl" />

          <div className="mx-auto bg-indigo-600/15 w-16 h-16 rounded-full flex items-center justify-center border border-indigo-500/25">
            <Mail className="h-8 w-8 text-indigo-400" />
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white tracking-tight">Bulk Mailer Launcher</h2>
            <p className="text-xs text-slate-400">Please enter security passcode to unlock</p>
          </div>

          <form onSubmit={(e) => {
            e.preventDefault();
            if (passcodeInput === "6395") {
              sessionStorage.setItem("bulk_app_auth", "true");
              localStorage.setItem("bulk_app_auth", "true");
              setIsAuthenticated(true);
            } else {
              setPasscodeError("Invalid passcode! Access Denied.");
              setPasscodeInput("");
            }
          }} className="space-y-4">
            <div className="space-y-1">
              <input 
                type="password"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 px-4 text-center font-mono text-lg tracking-widest text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="••••"
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={4}
                value={passcodeInput}
                onChange={(e) => {
                  setPasscodeInput(e.target.value.replace(/\D/g, ""));
                  setPasscodeError("");
                }}
              />
              {passcodeError && (
                <p className="text-[11px] text-rose-400 font-semibold">{passcodeError}</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg active:scale-98 text-white rounded-lg font-bold text-sm transition cursor-pointer"
            >
              Get Authorized & Enter
            </button>
          </form>
          
          <div className="text-[10px] text-slate-500 text-center font-mono">
            Outbound SMTP Service v2.1
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased pb-12">
      {/* 1. Sleek Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm">
              <Mail className="h-6 w-6" id="header_icon" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Bulk Mail Sender</h1>
              <p className="text-xs text-slate-500 font-medium">Outbound Client SMTP Panel</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowHelpModal(true)}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 text-sm bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-md font-semibold transition"
              id="help_trigger_btn"
            >
              <HelpCircle className="h-4 w-4" />
              <span>Gmail Setup Guide</span>
            </button>
            <div className="text-xs bg-slate-100 px-3 py-1.5 rounded-md font-mono text-slate-600">
              Host: dev-run-ready
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        
        {/* LAUNCHER GRID - Exact 4 rows side-by-side matching user alignment preferences */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-6">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Settings className="h-5 w-5 text-indigo-600 animate-spin-slow" />
              <h2 className="font-bold text-slate-800 text-lg">Campaign Control Panel</h2>
            </div>
            <div className="text-xs text-slate-500 font-medium">
              Symmetrical Double-Column Workspace
            </div>
          </div>

          {/* ROW 1: Sender Name & Your Gmail */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Sender Name */}
            <div className="space-y-1">
              <label className="block text-sm font-bold text-slate-700" htmlFor="sender_name_input">
                Sender Name <span className="text-xs font-normal text-slate-400 font-mono">(e.g., Aman Trades)</span>
              </label>
              <input
                type="text"
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                placeholder="Enter display name / Company"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                id="sender_name_input"
              />
            </div>

            {/* Right: Your Gmail */}
            <div className="space-y-1">
              <label className="block text-sm font-bold text-slate-700" htmlFor="smtp_sender_email">
                Your Gmail <span className="text-xs font-normal text-slate-400 font-mono">(login email ID)</span>
              </label>
              <input
                type="email"
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                placeholder="e.g. yatendrakumar882@gmail.com"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                id="smtp_sender_email"
              />
            </div>
          </div>

          {/* ROW 2: App Password & Subject */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: App Password */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700" htmlFor="smtp_app_password">
                  App Password <span className="text-xs font-normal text-slate-400 font-mono">(16-digit Google code)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  className="text-xs text-indigo-600 hover:underline font-semibold flex items-center space-x-0.5"
                >
                  <HelpCircle className="h-3 w-3" />
                  <span>Get 16-Digit Code</span>
                </button>
              </div>
              <div className="relative">
                <input
                  type="password"
                  className="w-full text-sm font-mono tracking-widest bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  id="smtp_app_password"
                />
              </div>
            </div>

            {/* Right: Subject */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700" htmlFor="mail_subject">
                  Subject <span className="text-xs font-normal text-slate-400 font-mono">({`{name}`} will parse name)</span>
                </label>
                {subjectSpamWords.length > 0 && (
                  <span className="text-[10px] text-rose-600 font-bold flex items-center space-x-1 animate-pulse">
                    <span>⚠️ Spam Word Detected! (स्पैम शब्द मिला)</span>
                  </span>
                )}
              </div>
              <input
                type="text"
                className={`w-full text-sm bg-slate-50 border rounded-lg py-2.5 px-3.5 focus:outline-none focus:ring-1 focus:bg-white transition ${
                  subjectSpamWords.length > 0
                    ? "border-rose-500 focus:ring-rose-500 text-rose-900 bg-rose-50/40"
                    : "border-slate-200 focus:ring-indigo-500"
                }`}
                placeholder="Enter email subject line"
                value={subjectTemplate}
                onChange={(e) => setSubjectTemplate(e.target.value)}
                id="mail_subject"
              />
              {subjectSpamWords.length > 0 && (
                <div className="text-[10.5px] text-rose-600 font-bold bg-rose-50 border border-rose-150 rounded-lg p-2 mt-1 leading-normal">
                  ⚠️ Subject contains spam trigger terms: <span className="underline font-extrabold">{subjectSpamWords.join(", ")}</span> (इससे बचें या सिंबल लगायें)
                </div>
              )}
            </div>
          </div>

          {/* ROW 3: Message Body & Recipients */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Message Body */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700" htmlFor="mail_body">
                  Message Body
                </label>
                {bodySpamWords.length > 0 && (
                  <span className="text-[10px] text-rose-600 font-bold flex items-center space-x-1 animate-pulse">
                    <span>⚠️ Spam Content Warning (स्पैम चेतावनी)</span>
                  </span>
                )}
              </div>
              <textarea
                rows={8}
                className={`w-full text-sm bg-slate-50 border rounded-lg p-3.5 focus:outline-none focus:ring-1 focus:bg-white leading-relaxed resize-y font-sans transition ${
                  bodySpamWords.length > 0
                    ? "border-rose-500 focus:ring-rose-500 text-rose-900 bg-rose-50/40"
                    : "border-slate-200 focus:ring-indigo-500"
                }`}
                placeholder="Write message here..."
                value={bodyTemplate}
                onChange={(e) => setBodyTemplate(e.target.value)}
                id="mail_body"
              />
              {bodySpamWords.length > 0 && (
                <div className="text-[10.5px] text-rose-600 font-bold bg-rose-50 border border-rose-150 rounded-lg p-2.5 mt-2 leading-normal">
                  ⚠️ Message Body contains spam trigger terms: <span className="underline font-extrabold">{bodySpamWords.join(", ")}</span> (स्पैम फ़ोल्डर से बचने के लिए इन्हें बदलें या 'Spam Protector' का उपयोग करें)
                </div>
              )}

              {/* Real-time Deliverability & Spam Score Widget */}
              {(() => {
                const analysis = getSpamAnalysis(subjectTemplate, bodyTemplate);
                return (
                  <div className="mt-2.5 p-3 rounded-xl border bg-white border-slate-200 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-bold text-slate-700">Inbox Health Analysis:</span>
                        <span className={`text-[10.5px] px-2 py-0.5 rounded-full font-bold text-white shadow-3xs ${
                          analysis.level === "good" ? "bg-emerald-600" :
                          analysis.level === "medium" ? "bg-amber-500" : "bg-rose-500"
                        }`}>
                          {analysis.score}% {analysis.level === "good" ? "High (Inbox)" : analysis.level === "medium" ? "Medium (Risk)" : "High Spam Threat"}
                        </span>
                      </div>
                      <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider font-mono">Live Scanner</span>
                    </div>

                    {/* Progress Bar meter */}
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${
                          analysis.level === "good" ? "bg-emerald-500" :
                          analysis.level === "medium" ? "bg-amber-400" : "bg-rose-500"
                        }`}
                        style={{ width: `${analysis.score}%` }}
                      ></div>
                    </div>

                    {analysis.issues.length > 0 ? (
                      <div className="space-y-1 pt-1 border-t border-slate-50">
                        <span className="block text-[9px] font-bold text-indigo-700 uppercase tracking-wider">How to secure INBOX delivery:</span>
                        <ul className="space-y-1">
                          {analysis.issues.map((issue, i) => (
                            <li key={i} className="text-[11px] text-slate-600 flex items-start space-x-1 leading-tight">
                              <span className="text-rose-500 font-bold shrink-0">⚠️</span>
                              <span>{issue}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-800 font-semibold bg-emerald-50/50 p-2 rounded-lg border border-emerald-100 leading-tight">
                        🎉 Excellent! Your campaign has 100% deliverability health. No spam words or duplicate risk factors found!
                      </div>
                    )}

                    {/* Bilingual tip */}
                    <p className="text-[10.5px] text-slate-500 leading-tight italic pt-1 border-t border-slate-50 pt-1.5">
                      <strong>💡 Tips:</strong> {analysis.level === "good" ? "आपका ईमेल बिल्कुल सुरक्षित है! Mails direct client inbox में लैंड करेंगे।" : "प्रत्येक व्यक्ति का ईमेल अलग होने के लिए संदेश में '{random_id}' का प्रयोग करें, ताकि एंटी-स्पैम फ़िल्टर्स बाईपास हो सकें।"}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Right: Recipients (comma or newline) */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700">
                  Recipients (comma or newline)
                </label>
                <label className="text-xs text-indigo-600 hover:underline hover:text-indigo-800 font-bold flex items-center space-x-1 cursor-pointer">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Import CSV / TXT</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
              <textarea
                rows={8}
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white leading-relaxed resize-y"
                placeholder="Aman Kumar, aman@example.com&#10;Vijay Sharma, vijay@example.com&#10;your_client@domain.com"
                value={rawRecipients}
                onChange={(e) => {
                  setRawRecipients(e.target.value);
                  setRecipientFileHelp("");
                }}
                id="recipient_raw_paste"
              />
              <div className="flex justify-between text-[11px] text-slate-500 pt-0.5">
                <span>Enter <strong>Name, Email</strong> per line.</span>
                <span className="font-semibold text-indigo-600">
                  Parsed count: {parsedRecipients.length} clients
                </span>
              </div>
              {recipientFileHelp && (
                <p className="text-xs text-emerald-700 font-medium bg-emerald-50 p-2 border border-emerald-100 rounded mt-1">
                  {recipientFileHelp}
                </p>
              )}
            </div>
          </div>

          {/* ROW 4: Send Control Panel & All Logout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Left Column: Send Controls */}
            <div className="space-y-1">
              <label className="block text-sm font-bold text-slate-700">
                Send <span className="text-xs font-normal text-slate-400 font-mono">(Campaign dispatch options)</span>
              </label>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700">
                    <Clock className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Batch Delay: {sendDelay}s (10 mails/batch)</span>
                  </div>
                  
                  {/* Advanced Mode dropdown inside quick access */}
                  <div className="flex items-center space-x-1 text-xs">
                    <span className="text-slate-400">Protocol:</span>
                    <select
                      className="bg-transparent border-none text-indigo-600 font-semibold p-0 text-xs focus:ring-0 cursor-pointer focus:outline-none"
                      value={smtpMode}
                      onChange={(e) => setSmtpMode(e.target.value)}
                      id="smtp_mode_select"
                    >
                      <option value="auto">Auto Port (465 SSL)</option>
                      <option value="465">Port 465 SSL</option>
                      <option value="587">Port 587 TLS</option>
                      <option value="gmail">Gmail Service Helper</option>
                    </select>
                  </div>
                </div>

                {/* Range slider for throttle */}
                <div className="space-y-1">
                   <input
                     type="range"
                     min="0.1"
                     max="15"
                     step="0.1"
                     className="w-full accent-indigo-600 cursor-pointer"
                     value={sendDelay}
                     onChange={(e) => setSendDelay(Number(e.target.value))}
                     id="delay_slider"
                   />
                   <div className="flex justify-between text-[9px] text-slate-400">
                     <span>0.1s (Instant Batch / Ultra Fast)</span>
                     <span className="text-emerald-600 font-semibold">1.0s (Best Balance / safe inbox)</span>
                     <span>15.0s (Max Safety per batch)</span>
                   </div>
                 </div>

                {/* Jitter (Anti-Bot Pattern Randomizer) toggle */}
                <div className="flex items-center justify-between bg-white p-2.5 border border-slate-200 rounded-lg shadow-2xs">
                  <div className="flex flex-col pr-2">
                    <span className="text-xs font-bold text-slate-700 flex items-center space-x-1">
                      <Cpu className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
                      <span>Smart Timing Randomizer (+Jitter)</span>
                    </span>
                    <span className="text-[10px] text-slate-500 leading-tight">Varies send delay randomly (breaks bot pattern) to inbox safely.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={useJitter}
                      onChange={(e) => setUseJitter(e.target.checked)}
                    />
                    <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {/* Action Trigger Buttons for Campaign */}
                <div className="grid grid-cols-3 gap-2">
                  {sendingState !== "sending" ? (
                    <button
                      onClick={startSendingQueue}
                      disabled={parsedRecipients.length === 0}
                      className={`col-span-2 flex items-center justify-center space-x-2 py-3 rounded-lg font-bold text-sm text-white transition cursor-pointer ${
                        parsedRecipients.length === 0 
                        ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                        : "bg-emerald-600 hover:bg-emerald-700 active:scale-98 shadow-sm"
                      }`}
                      id="campaign_play_btn"
                    >
                      <Play className="h-4 w-4 fill-white shrink-0" />
                      <span>{sendingState === "paused" ? "Resume Campaign" : "Send"}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseSending}
                      className="col-span-2 flex items-center justify-center space-x-2 py-3 bg-amber-500 hover:bg-amber-600 active:scale-98 text-white rounded-lg font-bold text-sm transition cursor-pointer shadow-sm"
                      id="campaign_pause_btn"
                    >
                      <Pause className="h-4 w-4 fill-white shrink-0" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    onClick={handleStopSending}
                    disabled={sendingState === "idle" && currentIndex === 0}
                    className={`flex items-center justify-center space-x-1.5 border rounded-lg text-xs font-bold transition cursor-pointer ${
                      sendingState === "idle" && currentIndex === 0
                      ? "border-slate-200 text-slate-300 cursor-not-allowed"
                      : "border-slate-300 bg-white hover:bg-slate-100 text-slate-700 active:scale-98"
                    }`}
                    id="campaign_stop_btn"
                  >
                    <Square className="h-3.5 w-3.5 fill-slate-700 shrink-0" />
                    <span>Stop</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Premium Deliverability and Session Management */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700 flex items-center space-x-1">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" />
                  <span>Deliverability Shield (इनबॉक्स सेटिंग)</span>
                </label>
                <button
                  type="button"
                  onClick={handleVerifySMTP}
                  disabled={verifyingSmtp || !senderEmail || !appPassword}
                  className="text-xs text-indigo-600 hover:underline font-bold disabled:text-slate-400"
                  id="verify_quick_trigger"
                >
                  {verifyingSmtp ? "Verifying..." : "Verify Link"}
                </button>
              </div>

              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-4">
                {/* 1. Layout selection */}
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-slate-600 flex items-center space-x-1">
                      <span>Email Design Layout:</span>
                    </span>
                    <span className="text-[10px] text-indigo-600 font-semibold font-mono">Select Output</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["pristine", "simple", "raw"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setHtmlLayout(mode)}
                        className={`text-[11px] py-2 px-1.5 rounded-lg border font-bold transition flex flex-col items-center justify-center space-y-0.5 text-center cursor-pointer ${
                          htmlLayout === mode
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                        title={
                          mode === "pristine" ? "Generates clean formal business card styling templates" :
                          mode === "simple" ? "Basic line-break HTML layout" : "Pure text email (No HTML code, maximally safe, bypasses all spam filters)"
                        }
                      >
                        <span className="capitalize">{mode === "raw" ? "Plain Text" : mode}</span>
                        <span className="text-[8px] opacity-80 font-normal">
                          {mode === "pristine" ? "Professional" : mode === "simple" ? "Compact" : "100% Safe"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Automated Helpers */}
                <div className="space-y-2">
                  {/* Append Unsubscribe Footnote */}
                  <div className="flex items-center justify-between bg-white p-2 border border-slate-200 rounded-lg shadow-3xs">
                    <div className="flex flex-col pr-1.5">
                      <span className="text-[11px] font-bold text-slate-700">Add RFC Unsubscribe footnote</span>
                      <span className="text-[9.5px] text-slate-400 leading-tight">Keeps mail safe from direct spam reporting.</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={useAutoUnsubscribe}
                        onChange={(e) => setUseAutoUnsubscribe(e.target.checked)}
                      />
                      <div className="w-7 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>

                  {/* Anti-Spam cryptographic footprint code */}
                  <div className="flex items-center justify-between bg-white p-2 border border-slate-200 rounded-lg shadow-3xs hover:border-slate-300 transition">
                    <div className="flex flex-col pr-1.5">
                      <span className="text-[11px] font-bold text-slate-700">Anti-Spam Footprint Tracker</span>
                      <span className="text-[9.5px] text-slate-400 leading-tight">Appends invisible dynamic hashes.</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={useAntiSpamFootprint}
                        onChange={(e) => setUseAntiSpamFootprint(e.target.checked)}
                      />
                      <div className="w-7 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>

                  {/* SPAM PROTECTOR ADVANCED TOOLS */}
                  <div className="border-t border-slate-200/80 pt-2 pb-1">
                    <span className="block text-[10px] font-bold text-indigo-700 uppercase tracking-widest mb-1.5 flex items-center space-x-1">
                      <span>⚙️ Spam Protector Shield (सुरक्षा कवच)</span>
                    </span>
                    <div className="space-y-2">
                      {/* Zero-width spacing */}
                      <div className="flex items-center justify-between bg-white p-2 border border-slate-200 rounded-lg shadow-3xs hover:border-slate-300 transition">
                        <div className="flex flex-col pr-1.5">
                          <span className="text-[11px] font-bold text-slate-700">Invisible Zero-Width Randomizer</span>
                          <span className="text-[9.5px] text-slate-400 leading-tight">inserts invisible spaces in text to randomize DKIM & content hashes.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={useZeroWidthPadding}
                            onChange={(e) => setUseZeroWidthPadding(e.target.checked)}
                          />
                          <div className="w-7 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>

                      {/* Subject Randomizer variant */}
                      <div className="flex items-center justify-between bg-white p-2 border border-slate-200 rounded-lg shadow-3xs hover:border-slate-300 transition">
                        <div className="flex flex-col pr-1.5">
                          <span className="text-[11px] font-bold text-slate-700">Subject Polymorphism Multi-Variant</span>
                          <span className="text-[9.5px] text-slate-400 leading-tight">Varies tags and invisible spaces inside subjects so they are 100% unique.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={useSubjectVariant}
                            onChange={(e) => setUseSubjectVariant(e.target.checked)}
                          />
                          <div className="w-7 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>

                      {/* Spam NLP bypass keyword filter */}
                      <div className="flex items-center justify-between bg-white p-2 border border-slate-200 rounded-lg shadow-3xs hover:border-slate-300 transition">
                        <div className="flex flex-col pr-1.5">
                          <span className="text-[11px] font-bold text-slate-700">Keyword Neutralizer NLP Shield</span>
                          <span className="text-[9.5px] text-slate-400 leading-tight">Shields sales/pricing terms (like f-r-e-e) with benign symbols to bypass NLP scanners.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={neutralizeSpamWords}
                            onChange={(e) => setNeutralizeSpamWords(e.target.checked)}
                          />
                          <div className="w-7 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200/60 pt-3 flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 font-medium">Session cache controls:</span>
                    <button
                      onClick={handleClearSMTPConfig}
                      className="text-[10.5px] text-rose-600 hover:text-rose-800 font-bold flex items-center space-x-1"
                      id="clear_smtp_btn"
                    >
                      <LogOut className="h-3 w-3" />
                      <span>All Logout & Clear Cache</span>
                    </button>
                  </div>

                  {/* Real-time verification notice feed */}
                  {smtpStatusMsg && (
                    <div className={`text-xs font-semibold flex items-start space-x-1.5 p-2 rounded-lg border ${
                      smtpVerified === true ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-rose-50 text-rose-800 border-rose-200"
                    }`}>
                      <div className="mt-0.5 shrink-0">
                        {smtpVerified === true ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-rose-600" />
                        )}
                      </div>
                      <div className="leading-tight text-[10.5px]">
                        {smtpStatusMsg}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM METRICS */}
        <div className="mt-6">
          
          {/* Campaign stats summary & progress (Full Width) */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <Layers className="h-4 w-4 text-indigo-600" />
                <h3 className="font-semibold text-slate-800">Campaign Dispatch Progress Metrics</h3>
              </div>
              <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                Active Queue: {currentIndex} / {stats.total}
              </span>
            </div>

            {/* Campaign progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-medium">Progress Bar</span>
                <span className="font-mono font-bold text-slate-700">{stats.progressPercent}% Completed</span>
              </div>
              <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden border border-slate-200 p-0.5">
                <div 
                  className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${stats.progressPercent}%` }}
                />
              </div>
            </div>

            {/* Bento statistics grids */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-slate-50 border border-slate-150 p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Success</div>
                <div className="text-xl font-bold text-emerald-600 font-mono mt-0.5">{stats.sentSuccess}</div>
              </div>
              <div className="bg-slate-50 border border-slate-150 p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Errors</div>
                <div className="text-xl font-bold text-rose-600 font-mono mt-0.5">{stats.sentFailed}</div>
              </div>
              <div className="bg-slate-50 border border-slate-150 p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Pending</div>
                <div className="text-xl font-bold text-amber-600 font-mono mt-0.5">{stats.pendingCount}</div>
              </div>
              <div className="bg-slate-50 border border-slate-150 p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Total Campaign</div>
                <div className="text-xl font-bold text-indigo-600 font-mono mt-0.5">{stats.total}</div>
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* GMAIL ACCESS HELP INSTRUCTION MODAL */}
      <AnimatePresence>
        {showHelpModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setShowHelpModal(false)}
            />

            {/* Modal Body */}
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative transform overflow-hidden rounded-xl bg-white text-left shadow-xl transition-all w-full max-w-lg border border-slate-200"
              >
                <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <HelpCircle className="h-5 w-5 text-indigo-400" />
                    <h3 className="font-bold text-base">Gmail App Password Setup</h3>
                  </div>
                  <button
                    onClick={() => setShowHelpModal(false)}
                    className="text-slate-400 hover:text-white font-bold text-lg cursor-pointer transition"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-5 space-y-4 text-xs text-slate-700 leading-relaxed font-sans">
                  <p>
                    Google <strong>App Passwords</strong> are required for external bulk mail engines. Standard Gmail passwords will be rejected by security policies.
                  </p>

                  <div className="bg-indigo-50 text-indigo-900 p-3.5 rounded-lg border border-indigo-100 font-medium space-y-1">
                    <p className="font-bold text-indigo-950 uppercase text-[10px] tracking-wider">Crucial Pre-requisite:</p>
                    <p>Your Gmail account MUST have <strong>2-Step Verification (2FA)</strong> activated so Google allows generating Keys.</p>
                  </div>

                  <h4 className="font-bold text-slate-800 uppercase tracking-tight text-[10px] mt-2">How to get a 16-character password step-by-step:</h4>
                  
                  <ol className="list-decimal pl-4 space-y-2.5">
                    <li>
                      Go to your <a href="https://myaccount.google.com/" target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline">Google Account settings page</a>.
                    </li>
                    <li>
                      Click on the <strong>Security</strong> tab on the left sidebar.
                    </li>
                    <li>
                      Under <strong>"How you sign in to Google"</strong>, click on <strong>"2-Step Verification"</strong>.
                    </li>
                    <li>
                      Scroll all the way down to the bottom of the page and click on <strong>"App passwords"</strong>.
                    </li>
                    <li>
                      Enter a custom label name (e.g., <code>BulkMailSender</code>) and click on <strong>Create</strong>.
                    </li>
                    <li>
                      Copy the generated <strong>16-character Yellow code</strong> (e.g., <code className="bg-amber-100 font-mono text-amber-900 px-1 font-bold">abcd efgh ijkl mnop</code>).
                    </li>
                    <li>
                      Paste it exactly into the App Password box in our panel. Safe space removal is applied automatically!
                    </li>
                  </ol>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">Your key is stored safely on your device.</span>
                    <button
                      onClick={() => setShowHelpModal(false)}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md font-semibold text-xs hover:bg-indigo-700 cursor-pointer transition shadow-xs"
                    >
                      I Got My Code
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. MAILS LIMIT FULL POPUP MODAL */}
      <AnimatePresence>
        {limitModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div 
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setLimitModalOpen(false)}
            />
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative transform overflow-hidden rounded-xl bg-white text-left shadow-xl transition-all w-full max-w-sm border border-rose-200"
              >
                <div className="bg-rose-600 text-white p-5 flex items-center space-x-2">
                  <AlertCircle className="h-5 w-5 shrink-0 animate-bounce" />
                  <h3 className="font-bold text-base">Mails Limit Full</h3>
                </div>

                <div className="p-5 space-y-4 text-xs font-sans text-slate-700 leading-relaxed">
                  <p className="font-semibold text-rose-700 text-sm">
                    Is Gmail account ki sending limit (27 mails) poori ho chuki hai!
                  </p>
                  
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2 font-sans text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Gmail Address:</span>
                      <strong className="text-slate-800 font-mono text-[11px] break-all">{limitModalSender}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Active Limit:</span>
                      <strong className="text-slate-800 font-bold text-rose-600">27 / 2 Hours</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Auto Reset At:</span>
                      <strong className="text-emerald-700 font-bold">{limitModalResetTime}</strong>
                    </div>
                  </div>

                  <p className="text-slate-500 leading-normal">
                    Tension na lein! Aap is Gmail ko logout karke doosri id se send kar sakte hain. Limit dynamic hai:
                  </p>

                  <div className="bg-indigo-50 text-indigo-950 p-3 rounded-lg text-[11px] leading-tight flex items-start space-x-2">
                    <Info className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold">Multiple Accounts scaling:</p>
                      <p className="mt-0.5">Har dynamic ID ke paas apna personal limit counter space hota hai (1 Gmail = 27, 2 Gmail = 54, 3 Gmail = 81).</p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex justify-end">
                    <button
                      onClick={() => setLimitModalOpen(false)}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs cursor-pointer transition shadow-xs"
                    >
                      Close / Thik Hai
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. SMTP TRANSMISSION ERROR / WRONG LOGIN DIALOG MODAL */}
      <AnimatePresence>
        {errorModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div 
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setErrorModalOpen(false)}
            />
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative transform overflow-hidden rounded-xl bg-white text-left shadow-xl transition-all w-full max-w-sm border border-amber-200"
              >
                <div className="bg-amber-500 text-white p-5 flex items-center space-x-2">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <h3 className="font-bold text-base">{errorModalTitle}</h3>
                </div>

                <div className="p-5 space-y-4 text-xs font-sans text-slate-700 leading-relaxed">
                  <p className="font-semibold text-amber-800 text-sm">
                    Mailing server se response errors aayi hai:
                  </p>
                  
                  <div className="bg-slate-50 border border-slate-150 rounded-lg p-4 font-mono text-[10px] text-slate-600 break-words leading-tight">
                    {errorModalMessage}
                  </div>

                  <div className="bg-amber-50 text-amber-900 p-3 rounded-lg text-[11px] leading-tight">
                    <strong>Sujhav (Tip):</strong> Google Security rule ke mutabik normal account password rejected hota hai. Gmail k safety setting me jaake, <strong>2-Step Verification</strong> enable karein, fir <strong>App Password (16 Letters)</strong> banayein.
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex justify-end">
                    <button
                      onClick={() => setErrorModalOpen(false)}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-semibold text-xs cursor-pointer transition shadow-xs"
                    >
                      Thik hai / Edit details
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

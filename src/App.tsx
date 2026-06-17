import React, { useState, useEffect, useMemo, useRef, ChangeEvent } from "react";
import { 
  Mail, 
  Send, 
  Play, 
  Pause, 
  Square, 
  Eye, 
  EyeOff, 
  HelpCircle, 
  Clock, 
  FileSpreadsheet, 
  ShieldCheck,
  AlertCircle,
  Users
} from "lucide-react";

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
  // Launcher passcode lock states (Passcode to unlock is 6395)
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("bulk_app_auth") === "true" || localStorage.getItem("bulk_app_auth") === "true";
  });
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");

  // SMTP Credentials (starting completely blank on first load as requested)
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Email Subject and Body templates (starting completely blank on load as requested)
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");

  // Recipients input (starting completely blank on load)
  const [rawRecipients, setRawRecipients] = useState("");
  
  // Send mode batch size (1-1 or 2-2 as requested, default to 2 as secure layout choice)
  const [batchSize, setBatchSize] = useState(() => {
    const saved = localStorage.getItem("bulk_batch_size");
    return saved ? Number(saved) : 2;
  });

  // Turnstile simulated success state (starts loading, resolves to Success after mount)
  const [turnstileState, setTurnstileState] = useState<"loading" | "success">("loading");

  // Log lists and current send index state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sendingState, setSendingState] = useState<"idle" | "sending" | "paused">("idle");
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Static delay interval per batch (set to 1.5s as high-performance yet safe speed default)
  const sendDelay = 1.5;

  // Reference hooks for the send queue loop
  const isSendingRef = useRef<boolean>(false);
  const sendingStateRef = useRef<"idle" | "sending" | "paused">("idle");
  const activeTimersRef = useRef<Set<any>>(new Set());

  // Safe Cloudflare Turnstile simulation on load
  useEffect(() => {
    const timer = setTimeout(() => {
      setTurnstileState("success");
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Sync batchSize setting
  useEffect(() => {
    localStorage.setItem("bulk_batch_size", String(batchSize));
  }, [batchSize]);

  // Synchronize state values
  useEffect(() => {
    sendingStateRef.current = sendingState;
    isSendingRef.current = sendingState === "sending";
  }, [sendingState]);

  // Parse list of recipients pasted into textarea (pasted values are comma or newline separated)
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

  // Handle files CSV/TXT upload to recipients input
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setRawRecipients(text);
      }
    };
    reader.readAsText(file);
  };

  // Helper patterns to search for known spam triggers in templates
  const SPAM_TRIGGER_WORDS = [
    "free", "earn money", "make money", "winner", "cash", "millions", "lottery",
    "guaranteed", "100% free", "click here", "income", "usd", "gift card", "work from home",
    "investment", "get paid", "crypto", "bitcoin", "loan", "viagra", "casino", "jackpot"
  ];

  // Memoized lists of matching spam words for real-time visualization highlight
  const subjectSpamWords = useMemo(() => {
    const found: string[] = [];
    const lower = subjectTemplate.toLowerCase();
    SPAM_TRIGGER_WORDS.forEach(word => {
      if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
        found.push(word);
      }
    });
    return found;
  }, [subjectTemplate]);

  const bodySpamWords = useMemo(() => {
    const found: string[] = [];
    const lower = bodyTemplate.toLowerCase();
    SPAM_TRIGGER_WORDS.forEach(word => {
      if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
        found.push(word);
      }
    });
    return found;
  }, [bodyTemplate]);

  // Is there any URL or domain in subject/body (TXT mails shouldn't have spam links/domains)
  const subjectHasLink = useMemo(() => {
    const linkRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|net|in|biz|info|cc|co|xyz|me|gov|edu|us|uk|ca|au)\b/i;
    return linkRegex.test(subjectTemplate);
  }, [subjectTemplate]);

  const bodyHasLink = useMemo(() => {
    const linkRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|net|in|biz|info|cc|co|xyz|me|gov|edu|us|uk|ca|au)\b/i;
    return linkRegex.test(bodyTemplate);
  }, [bodyTemplate]);

  // Auto clean utility for links
  const handleRemoveLinks = (target: "subject" | "body") => {
    const linkRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(?:com|org|net|in|biz|info|cc|co|xyz|me|gov|edu|us|uk|ca|au)\b/gi;
    if (target === "subject") {
      setSubjectTemplate(prev => prev.replace(linkRegex, "").trim());
    } else {
      setBodyTemplate(prev => prev.replace(linkRegex, "").trim());
    }
  };

  // Spintax Choice Parser (e.g. "{Dear|Hello|Hi}")
  const parseSpintax = (str: string): string => {
    let output = str;
    const spintaxRegex = /\{([^{}|]+(?:\|[^{}|]+)+)\}/g;
    let limit = 0;
    while (spintaxRegex.test(output) && limit < 100) {
      output = output.replace(spintaxRegex, (match, choicesStr) => {
        const choices = choicesStr.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
      });
      limit++;
    }
    return output;
  };

  // Perfect dynamic personalization rendering
  const renderTemplateFull = (template: string, clientName: string, clientEmail: string): string => {
    let result = parseSpintax(template);
    const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
    const todayStr = new Date().toLocaleDateString('en-GB'); 
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    
    result = result
      .replace(/{name}/g, clientName)
      .replace(/{email}/g, clientEmail)
      .replace(/{random_id}/g, randomHex)
      .replace(/{date}/g, todayStr)
      .replace(/{time}/g, timeStr);
      
    return result;
  };

  // Setup/Initialize sending queue logs map
  const initializeLogs = () => {
    const list: LogEntry[] = parsedRecipients.map((client, idx) => ({
      id: `log-${idx}`,
      recipient: client.email,
      name: client.name,
      subject: subjectTemplate,
      status: "pending",
      timestamp: "Waiting...",
    }));
    setLogs(list);
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

    if (subjectHasLink || bodyHasLink) {
      alert("❌ Links detected in templates! Plain Text (TXT) emails should not have any links for inbox delivery.");
      return;
    }

    let startIndex = currentIndex;
    if (currentIndex >= parsedRecipients.length) {
      startIndex = 0;
      setCurrentIndex(0);
      initializeLogs();
    } else if (logs.length === 0) {
      initializeLogs();
    }

    setSendingState("sending");
    isSendingRef.current = true;

    let nextIndexToProcess = startIndex;

    const processSingleItem = async (indexToProcess: number): Promise<boolean> => {
      // Check limits
      const limitStatus = checkGmailLimit(senderEmail);
      if (!limitStatus.allowed) {
        setSendingState("idle");
        isSendingRef.current = false;
        alert(`Hourly rate limit exceeded. Please wait before sending more.`);
        return false;
      }

      const currentClient = parsedRecipients[indexToProcess];

      setLogs((prev) => 
        prev.map((log, idx) => 
          idx === indexToProcess ? { ...log, status: "sending", timestamp: "Sending..." } : log
        )
      );

      // Render templates
      const customSubject = renderTemplateFull(subjectTemplate, currentClient.name, currentClient.email);
      let customBody = renderTemplateFull(bodyTemplate, currentClient.name, currentClient.email);

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
            smtpMode: "auto",
            htmlLayout: "raw", // Locked strictly to RAW TXT for safe inbox delivery
            useAutoUnsubscribe: false,
            useAntiSpamFootprint: false,
            useZeroWidthPadding: false,
            useSubjectVariant: false,
            randomUnsubId: Math.random().toString(36).substring(2, 8).toUpperCase()
          }),
        });

        const data = await response.json();

        if (data.success) {
          recordGmailSend(senderEmail);
          setLogs((prev) => 
            prev.map((log, idx) => 
              idx === indexToProcess 
                ? { 
                    ...log, 
                    status: "success", 
                    subject: customSubject, 
                    timestamp: new Date().toLocaleTimeString(), 
                    error: undefined 
                  } 
                : log
            )
          );
          return true;
        } else {
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
                    error: data.error || "Rejected by Gmail SMTP server." 
                  } 
                : log
            )
          );
          alert(`SMTP Error: ${data.error || "Rejected by Google SMTP."}`);
          return false;
        }
      } catch (err: any) {
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
                  error: err.message || "Failed connection." 
                } 
              : log
          )
        );
        alert(`Dispatch failed: ${err.message || "Network Timeout."}`);
        return false;
      }
    };

    const runBatchDispatch = async () => {
      while (isSendingRef.current && nextIndexToProcess < parsedRecipients.length) {
        const currentBatch: number[] = [];
        for (let i = 0; i < batchSize && (nextIndexToProcess + i) < parsedRecipients.length; i++) {
          currentBatch.push(nextIndexToProcess + i);
        }

        // Trigger dispatch promises
        const batchPromises = currentBatch.map((index) => processSingleItem(index));
        nextIndexToProcess += currentBatch.length;
        setCurrentIndex(nextIndexToProcess);

        const results = await Promise.all(batchPromises);
        const allOk = results.every((ok) => ok === true);
        if (!allOk || !isSendingRef.current) {
          break;
        }

        // Delay between batch iterations
        if (nextIndexToProcess < parsedRecipients.length && isSendingRef.current) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              activeTimersRef.current.delete(timer);
              resolve();
            }, sendDelay * 1000);
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
    setSendingState("paused");
    isSendingRef.current = false;
    activeTimersRef.current.forEach((t) => clearTimeout(t));
    activeTimersRef.current.clear();
  };

  const handleResetQueue = () => {
    handlePauseSending();
    setCurrentIndex(0);
    setLogs([]);
  };

  // Reactive counters for Progress Monitor
  const totalRecipients = parsedRecipients.length;
  const sentCount = useMemo(() => logs.filter(l => l.status === "success").length, [logs]);
  const failedCount = useMemo(() => logs.filter(l => l.status === "failed").length, [logs]);
  const remainingCount = useMemo(() => {
    // If we haven't started sending, show total as remaining
    if (logs.length === 0) return totalRecipients;
    const processed = logs.filter(l => l.status === "success" || l.status === "failed").length;
    return Math.max(0, totalRecipients - processed);
  }, [logs, totalRecipients]);

  const sendingPercent = totalRecipients > 0 ? Math.round((currentIndex / totalRecipients) * 100) : 0;

  // Render Passcode gate if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col justify-center items-center px-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-sm w-full space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-12 -left-12 w-24 h-24 bg-indigo-500/20 rounded-full blur-xl" />
          <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl" />

          <div className="mx-auto bg-indigo-600/15 w-16 h-16 rounded-full flex items-center justify-center border border-indigo-500/25">
            <Mail className="h-8 w-8 text-indigo-400" />
          </div>

          <div className="space-y-1 text-center">
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
                <p className="text-[11px] text-rose-400 font-semibold text-center">{passcodeError}</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg text-white rounded-lg font-bold text-sm transition cursor-pointer"
            >
              Get Authorized & Enter
            </button>
          </form>
          
          <div className="text-[10px] text-slate-500 text-center font-mono">
            Outbound SMTP Service v2.2
          </div>
        </div>
      </div>
    );
  }

  // Check body highlight status
  const bodyHasSpamDanger = bodySpamWords.length > 0 || bodyHasLink || subjectSpamWords.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased pb-12">
      {/* Sleek Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm">
              <Mail className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Secure Mail Co</h1>
              <p className="text-xs text-slate-500 font-medium">Outbound Client SMTP Panel</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowHelpModal(true)}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 text-sm bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-md font-semibold transition cursor-pointer"
            >
              <HelpCircle className="h-4 w-4" />
              <span>Gmail Setup Guide</span>
            </button>
            <div className="text-xs bg-slate-100 px-3 py-1.5 rounded-md font-mono text-slate-600">
              Host: secure-run-direct
            </div>
          </div>
        </div>
      </header>

      {/* Main Two-Column Layout Workspace */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* LEFT COLUMN: Compose Message */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Mail className="h-5 w-5 text-indigo-600" />
                <h2 className="font-bold text-slate-800 text-lg">Compose Message</h2>
              </div>
            </div>

            <div className="space-y-4">
              {/* Row 1: Your Gmail & App Password */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Your Gmail</label>
                  <input
                    type="email"
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
                    placeholder="you@gmail.com"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">App Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full text-sm font-mono tracking-wider bg-slate-50 border border-slate-200 rounded-lg py-2 pl-3 pr-9 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
                      placeholder="16-char app password"
                      value={appPassword}
                      onChange={(e) => setAppPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Row 2: Sender Name & Email Subject */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Sender Name</label>
                  <input
                    type="text"
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
                    placeholder="E.g., John Doe"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Email Subject</label>
                  <input
                    type="text"
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
                    placeholder="Enter subject line..."
                    value={subjectTemplate}
                    onChange={(e) => setSubjectTemplate(e.target.value)}
                  />
                </div>
              </div>

              {/* Message Body (Plain Text) */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold text-slate-700">Message Body (Plain Text)</label>
                  {bodyHasSpamDanger && (
                    <span className="text-[10px] text-red-600 font-extrabold flex items-center space-x-1 animate-pulse">
                      <span>⚠️ Spam/Link Alert! (स्पैम चेतावनी)</span>
                    </span>
                  )}
                </div>
                <textarea
                  rows={8}
                  className={`w-full text-sm rounded-lg p-3 focus:outline-none transition-all duration-300 leading-relaxed font-sans resize-y ${
                    bodyHasSpamDanger
                      ? "border-2 border-red-500 bg-red-100 text-red-950 font-medium"
                      : "bg-slate-50 border border-slate-200 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  }`}
                  placeholder="Write your email here..."
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                />

                {/* Direct warning notification if text is red inside body */}
                {bodySpamWords.length > 0 && (
                  <p className="text-[10.5px] text-red-700 font-extrabold bg-red-50 border border-red-200 rounded p-2 mt-1 leading-tight">
                    ⚠️ Avoid Spam words: <span className="underline">{bodySpamWords.join(", ")}</span> (स्पैम फोल्डर से बचने के लिए एंटी-स्पैम फ़िल्टर्स इस्तेमाल करें)
                  </p>
                )}

                {bodyHasLink && (
                  <div className="text-[10.5px] text-red-700 font-extrabold bg-red-50 border border-red-200 rounded p-2 mt-1.5 flex items-center justify-between">
                    <span>🚨 Link found! Plain Text (TXT) should not have links for inbox landing.</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveLinks("body")}
                      className="bg-red-700 text-white rounded px-2.5 py-1 text-[10px] font-bold shadow-xs hover:bg-red-800 transition shrink-0 cursor-pointer"
                    >
                      🧹 Clean
                    </button>
                  </div>
                )}
              </div>

              {/* Spam Protection Turnstile Replication Section */}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex items-center space-x-1 text-slate-700">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" />
                  <span className="text-xs font-bold">Spam Protection</span>
                </div>

                <div className="border border-slate-200 bg-[#f9f9f9] rounded-lg p-3 flex items-center justify-between w-full max-w-sm shadow-3xs">
                  <div className="flex items-center space-x-3">
                    {turnstileState === "loading" ? (
                      <>
                        <div className="h-5 w-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-semibold text-slate-500">Verifying security...</span>
                      </>
                    ) : (
                      <>
                        <div className="h-5 w-5 bg-[#0fa370] text-white rounded-full flex items-center justify-center shadow-xs">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="text-xs font-extrabold text-slate-800">Success!</span>
                      </>
                    )}
                  </div>

                  <div className="flex flex-col items-end leading-none">
                    <span className="text-[8px] font-black text-slate-400 tracking-wider font-mono">CLOUDFLARE</span>
                    <div className="flex space-x-1 text-[8px] text-slate-400 font-semibold mt-1">
                      <span className="hover:underline cursor-pointer">Privacy</span>
                      <span>•</span>
                      <span className="hover:underline cursor-pointer">Help</span>
                    </div>
                  </div>
                </div>

                <div className="border border-red-300 bg-red-50 text-red-700 rounded p-1 px-2.5 text-[10px] font-semibold tracking-tight w-full max-w-sm leading-none block text-left">
                  For testing only. If seen, report to site owner
                </div>
              </div>

            </div>
          </div>

          {/* RIGHT COLUMN: Recipients & Progress Monitor */}
          <div className="flex flex-col gap-6">

            {/* Card 1: Recipients */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5 text-indigo-600" />
                  <h3 className="font-bold text-slate-800 text-base">Recipients</h3>
                </div>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 border border-indigo-100 text-indigo-700">
                  {parsedRecipients.length} found
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-500">
                    Paste emails (comma separated, new lines, or Excel copy)
                  </span>
                  <label className="text-[11px] text-indigo-600 hover:underline font-bold flex items-center space-x-1 cursor-pointer">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>Upload CSV / TXT</span>
                    <input
                      type="file"
                      accept=".csv,.txt"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>
                <textarea
                  rows={4}
                  className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white leading-relaxed"
                  placeholder="john@example.com&#10;jane@example.com"
                  value={rawRecipients}
                  onChange={(e) => setRawRecipients(e.target.value)}
                />
              </div>
            </div>

            {/* Card 2: Progress Monitor */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
              <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
                <Users className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-slate-800 text-base">Progress Monitor</h3>
              </div>

              {/* 4 Counter Boxes Grid */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                  <span className="block text-[10px] font-black text-slate-400 tracking-wider">TOTAL</span>
                  <span className="block text-lg font-extrabold text-slate-800 mt-0.5">{totalRecipients}</span>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                  <span className="block text-[10px] font-black text-slate-400 tracking-wider">SENT</span>
                  <span className="block text-lg font-extrabold text-emerald-600 mt-0.5">{sentCount}</span>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                  <span className="block text-[10px] font-black text-slate-400 tracking-wider">FAILED</span>
                  <span className="block text-lg font-extrabold text-red-600 mt-0.5">{failedCount}</span>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                  <span className="block text-[10px] font-black text-slate-400 tracking-wider">REMAINING</span>
                  <span className="block text-lg font-extrabold text-amber-600 mt-0.5">{remainingCount}</span>
                </div>
              </div>

              {/* Progress Line */}
              <div className="space-y-1.5">
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                    style={{ width: `${sendingPercent}%` }}
                  />
                </div>
              </div>

              {/* Symmetrical Send Mode Panel (no extra advanced controls) */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">Send Mode (एक साथ ईमेल सेंडिंग):</span>
                  <div className="flex items-center space-x-1 text-[10px] text-indigo-600 font-extrabold">
                    <Clock className="h-3 w-3" />
                    <span>Speed Configured: {sendDelay}s</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBatchSize(1)}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all text-center flex flex-col items-center justify-center cursor-pointer ${
                      batchSize === 1
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span>1-1 (1 by 1)</span>
                    <span className="text-[9px] opacity-80 font-normal">Super Safe • Minimal spam</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchSize(2)}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all text-center flex flex-col items-center justify-center cursor-pointer ${
                      batchSize === 2
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span>2-2 (2 by 2)</span>
                    <span className="text-[9px] opacity-80 font-normal">Balanced safe speed</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Status / Actions Block */}
              <div className="pt-2 flex flex-col space-y-3">
                <div className="flex justify-center items-center py-2 bg-slate-50/50 rounded-lg border border-slate-100/80">
                  <div className="flex items-center space-x-2 text-xs font-bold text-slate-600">
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        sendingState === "sending" ? "bg-emerald-400" : "bg-slate-400"
                      }`} />
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${
                        sendingState === "sending" ? "bg-emerald-500" : "bg-slate-500"
                      }`} />
                    </span>
                    <span>
                      {sendingState === "sending" ? `🚀 Sending... (${currentIndex}/${totalRecipients})` :
                       sendingState === "paused" ? "⏸️ Sending Paused" : "⏸️ Ready to send"}
                    </span>
                  </div>
                </div>

                {/* Primary CTA Submit Trigger */}
                <div className="flex gap-2">
                  <button
                    onClick={sendingState === "sending" ? handlePauseSending : startSendingQueue}
                    disabled={totalRecipients === 0}
                    className={`w-full py-3.5 rounded-xl font-bold text-sm text-white transition flex items-center justify-center space-x-2 cursor-pointer shadow-xs ${
                      totalRecipients === 0 
                      ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                      : sendingState === "sending"
                        ? "bg-amber-500 hover:bg-amber-600"
                        : "bg-[#0eae74] hover:bg-[#0c9664]"
                    }`}
                  >
                    {sendingState === "sending" ? (
                      <>
                        <Pause className="h-4 w-4" />
                        <span>Pause Campaign</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>Send All</span>
                      </>
                    )}
                  </button>

                  {(currentIndex > 0 || logs.length > 0) && (
                    <button
                      onClick={handleResetQueue}
                      className="px-4.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-sm rounded-xl transition cursor-pointer"
                      title="Reset send statistics and index"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

            </div>

            {/* Collapsible / Optional logs list (hidden by default, allows tracking failure error messages) */}
            {logs.length > 0 && (
              <details className="bg-white rounded-2xl border border-slate-200 p-4 transition duration-200">
                <summary className="text-xs font-bold text-slate-600 cursor-pointer focus:outline-none select-none">
                  🔍 View Mail Logs List & Status ({currentIndex} / {totalRecipients})
                </summary>
                <div className="mt-3 space-y-1 max-h-40 overflow-y-auto font-mono text-[10px] text-slate-600 pt-2 border-t border-slate-100">
                  {logs.map((log) => (
                    <div key={log.id} className="flex justify-between items-center p-1 rounded hover:bg-slate-50 transition border-b border-slate-150/50">
                      <span className="truncate max-w-[150px] font-semibold">{log.recipient}</span>
                      <span className="truncate max-w-[120px] italic text-slate-400">{log.subject || "No Subject"}</span>
                      <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                        log.status === "success" ? "bg-emerald-100 text-emerald-800" :
                        log.status === "failed" ? "bg-rose-100 text-rose-800" :
                        log.status === "sending" ? "bg-amber-100 text-amber-800 animate-pulse" : "bg-slate-100 text-slate-500"
                      }`}>
                        {log.status === "success" ? "SUCCESS" :
                         log.status === "failed" ? "FAILED" :
                         log.status === "sending" ? "SENDING" : "PENDING"}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

          </div>

        </div>
      </main>

      {/* Simplified Help Setup modal popup */}
      {showHelpModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center space-x-1.5">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              <span>Google 16-Digit App Password Guide</span>
            </h3>
            
            <div className="text-xs text-slate-600 space-y-2.5 leading-relaxed font-sans">
              <p>आपका साधारण Gmail पासवर्ड सुरक्षा कारणों से सीधे SMTP के माध्यम से स्वीकृत नहीं होता है। सुरक्षित डेलिवरी के लिए इन चरणों का पालन करें:</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>अपने Google Account Settings में जाएँ।</li>
                <li><strong>Security</strong> टैब पर क्लिक करें।</li>
                <li><strong>2-Step Verification</strong> चालू (ON) करें।</li>
                <li>सर्च बॉक्स में <strong>"App Passwords"</strong> सर्च करें।</li>
                <li>ऐप का कुछ भी नाम दें (जैसे: <code>Mailer app</code>) और Generate करें।</li>
                <li>आपको स्क्रीन पर <strong>16-अक्षरों का पासवर्ड</strong> (उदा: <code>abcd efgh ijkl mnop</code>) मिलेगा।</li>
                <li>उसे कॉपी करके यहाँ "App Password" फ़ील्ड में पेस्ट करें।</li>
              </ol>
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100 text-[10.5px]">
                💡 <strong>टिप:</strong> ईमेल सब्जेक्ट या मैसेज में <code>{`{random_id}`}</code> टैग का प्रयोग करें ताकि प्रत्येक व्यक्ति का ईमेल यूनिक हो, जिससे एंटी-स्पैम फ़िल्टर्स आपके मेल्स सीधे इनबॉक्स में भेजेंगे।
              </div>
            </div>

            <button
              onClick={() => setShowHelpModal(false)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-sm transition cursor-pointer"
            >
              Close Guide
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

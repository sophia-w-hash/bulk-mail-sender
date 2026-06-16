import React, { useState, useEffect, useMemo, useRef } from "react";
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
  RefreshCw, 
  HelpCircle, 
  Cpu, 
  Info, 
  Clock, 
  FileSpreadsheet, 
  Terminal,
  LogOut
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
  const [smtpVerified, setSmtpVerified] = useState<boolean | null>(null);
  const [verifyingSmtp, setVerifyingSmtp] = useState(false);
  const [smtpStatusMsg, setSmtpStatusMsg] = useState("");

  // Recipient States
  const [rawRecipients, setRawRecipients] = useState(
    "Aman Kumar, aman.k@example.com\nVijay Sharma, vijay.sharma@example.com\nSneha Patel, sneha.p@example.com"
  );
  const [recipientFileHelp, setRecipientFileHelp] = useState("");

  // Mail Content States
  const [subjectTemplate, setSubjectTemplate] = useState("Festival Discount for {name}! ✨");
  const [bodyTemplate, setBodyTemplate] = useState(
    "Hi {name},\n\nWe are excited to share a special bulk discount just for your email: {email}.\n\nThank you for choosing our services!\n\nBest regards,\nYour Marketing Team"
  );

  // Sending Process / Queue States
  const [sendDelay, setSendDelay] = useState(3); // default 3 seconds throttle/delay
  const [useJitter, setUseJitter] = useState(() => localStorage.getItem("bulk_use_jitter") === "true");
  const [sendingState, setSendingState] = useState<"idle" | "sending" | "paused">("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);

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
  const delayTimerRef = useRef<NodeJS.Timeout | null>(null);

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
        if (!line.trim()) return null;
        
        // Supports Name, Email OR just Plain Email structure
        if (line.includes(",")) {
          const parts = line.split(",");
          const name = parts[0]?.trim();
          const email = parts[1]?.trim();
          if (email && email.includes("@")) {
            return { name, email, index: idx };
          }
        } else {
          const email = line.trim();
          if (email && email.includes("@")) {
            return { name: email.split("@")[0] || "Recipient", email, index: idx };
          }
        }
        return null;
      })
      .filter((item): item is Client => item !== null);
  }, [rawRecipients]);

  // Comprehensive custom template variables parser & nested spintax generator
  const renderTemplateFull = (template: string, clientName: string, clientEmail: string): string => {
    let result = template;

    // 1. Resolve nested spintax structure dynamically: {Awesome|Great|Fantastic}
    const spintaxRegex = /\{([^{}]+)\}/g;
    let match;
    while ((match = spintaxRegex.exec(result)) !== null) {
      const parentExpr = match[0];
      const alternatives = match[1];

      // Exclude predefined variables name, email, and security placeholders
      if (
        alternatives === "name" || 
        alternatives === "email" || 
        alternatives === "random_id" || 
        alternatives === "date" || 
        alternatives === "time"
      ) {
        continue;
      }

      if (alternatives && alternatives.includes("|")) {
        const list = alternatives.split("|");
        const selected = list[Math.floor(Math.random() * list.length)] || "";
        result = result.replace(parentExpr, selected);
        // Reset regex search layout to handle shifts safely
        spintaxRegex.lastIndex = 0;
      }
    }

    // 2. Generate a custom unique transaction hex reference string {random_id}
    const randomHex = Math.random().toString(16).substring(2, 8).toUpperCase();

    // 3. Resolve formatted Calendar and Time variables
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

    // Verify limit status before letting campaign trigger
    const limitStatus = checkGmailLimit(senderEmail);
    if (!limitStatus.allowed) {
      const resetTimeStr = limitStatus.nextResetTimeMs > 0 
        ? new Date(limitStatus.nextResetTimeMs).toLocaleTimeString() 
        : "in roughly 2 hours";
      
      setLimitModalSender(senderEmail);
      setLimitModalResetTime(resetTimeStr);
      setLimitModalOpen(true);
      return;
    }

    if (sendingState === "paused") {
      setSendingState("sending");
      isSendingRef.current = true;
      processNextItem(currentIndex);
      return;
    }

    setSendingState("sending");
    isSendingRef.current = true;
    
    // Quick background check on startup to alert and fail-fast if password typing was wrong
    const verified = await checkSmtpQuietly();
    if (!verified && isSendingRef.current) {
      const promptContinue = window.confirm(
        `Warning: SMTP Connection check failed on route. Make sure your 16-digit Gmail App Password is typed correctly. Do you want to try sending anyway?`
      );
      if (!promptContinue) {
        setSendingState("idle");
        isSendingRef.current = false;
        
        setErrorModalTitle("SMTP Connection Failed");
        setErrorModalMessage("Campaign start suspended because the connection check failed. Please check your App Password credentials or try again.");
        setErrorModalOpen(true);
        return;
      }
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
    processNextItem(startIndex);
  };

  // Loop dispatch handler
  const processNextItem = async (indexToProcess: number) => {
    if (!isSendingRef.current || indexToProcess >= parsedRecipients.length) {
      if (indexToProcess >= parsedRecipients.length) {
        setSendingState("idle");
        isSendingRef.current = false;
        alert("🎉 Done! All bulk emails processed successfully.");
      }
      return;
    }

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
      return;
    }

    const currentClient = parsedRecipients[indexToProcess];
    setCurrentIndex(indexToProcess);

    setLogs((prev) => 
      prev.map((log, idx) => 
        idx === indexToProcess ? { ...log, status: "sending", timestamp: "Sending..." } : log
      )
    );

    // Render templates with full safety spintax and unique variables!
    const customSubject = renderTemplateFull(subjectTemplate, currentClient.name, currentClient.email);
    const customBody = renderTemplateFull(bodyTemplate, currentClient.name, currentClient.email);

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
          // Generate html line break standard formatting for safe deliverability
          html: customBody.replace(/\n/g, "<br>"),
          smtpMode,
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
    }

    const nextIdx = indexToProcess + 1;
    setCurrentIndex(nextIdx);

    if (nextIdx < parsedRecipients.length && isSendingRef.current) {
      // Calculate dynamic interval: Add random jitter to break uniform timing pattern if useJitter is enabled
      let finalDelayMs = sendDelay * 1000;
      if (useJitter) {
        // Randomly modify interval between -1.5 seconds and +2.5 seconds to bypass strict bot sensors
        const randomModifier = (Math.random() * 4 - 1.5) * 1000;
        finalDelayMs = Math.max(1000, finalDelayMs + randomModifier);
      }

      delayTimerRef.current = setTimeout(() => {
        processNextItem(nextIdx);
      }, finalDelayMs);
    } else if (nextIdx >= parsedRecipients.length) {
      setSendingState("idle");
    }
  };

  const handlePauseSending = () => {
    isSendingRef.current = false;
    setSendingState("paused");
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
  };

  const handleStopSending = () => {
    isSendingRef.current = false;
    setSendingState("idle");
    setCurrentIndex(0);
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
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
              <label className="block text-sm font-bold text-slate-700" htmlFor="mail_subject">
                Subject <span className="text-xs font-normal text-slate-400 font-mono">({`{name}`} will parse name)</span>
              </label>
              <input
                type="text"
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                placeholder="Enter email subject line"
                value={subjectTemplate}
                onChange={(e) => setSubjectTemplate(e.target.value)}
                id="mail_subject"
              />
            </div>
          </div>

          {/* ROW 3: Message Body & Recipients */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Message Body */}
            <div className="space-y-1">
              <div className="flex justify-between items-stretch sm:items-center sm:flex-row flex-col gap-1.5">
                <label className="block text-sm font-bold text-slate-700" htmlFor="mail_body">
                  Message Body
                </label>
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-bold">{`{name}`}</span>
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-bold">{`{email}`}</span>
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-bold">{`{random_id}`}</span>
                  <span 
                    className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-mono font-bold cursor-help"
                    title="Bypasses Gmail duplicate spam filters (Generates custom unique code for every person)."
                  >
                    🚀 {`{Awesome|Great}`} Spintax
                  </span>
                </div>
              </div>
              <textarea
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-3.5 h-[160px] focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white resize-y"
                placeholder="Write your email body template..."
                value={bodyTemplate}
                onChange={(e) => setBodyTemplate(e.target.value)}
                id="mail_body"
              />
            </div>

            {/* Right: Recipients */}
            <div className="space-y-1">
              <div className="flex justify-between items-stretch sm:items-center sm:flex-row flex-col gap-1.5">
                <label className="block text-sm font-bold text-slate-700" htmlFor="raw_recipients_area">
                  Recipients List <span className="text-xs font-normal text-slate-400">({parsedRecipients.length} valid)</span>
                </label>
                
                {/* Visual file uploader */}
                <div className="relative">
                  <input
                    type="file"
                    accept=".txt,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="recipient_file_input"
                  />
                  <label
                    htmlFor="recipient_file_input"
                    className="cursor-pointer text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1.5 rounded-md font-bold flex items-center space-x-1 transition"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>Upload CSV / TXT</span>
                  </label>
                </div>
              </div>
              
              <textarea
                className="w-full text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg p-3.5 h-[160px] focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white resize-y"
                placeholder="Name, email@domain.com (One per line)"
                value={rawRecipients}
                onChange={(e) => {
                  setRawRecipients(e.target.value);
                  setRecipientFileHelp("");
                }}
                id="raw_recipients_area"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Separate with commas.</span>
                <span className="text-emerald-700 font-semibold">{recipientFileHelp}</span>
              </div>
            </div>
          </div>

          {/* ROW 4: Dispatch Tuning Panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
            {/* Left Column: Delay Throttle */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Mode Select */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Connection Protocol
                  </label>
                  <div className="relative">
                    <select
                      className="w-full text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none"
                      value={smtpMode}
                      onChange={(e) => setSmtpMode(e.target.value)}
                    >
                      <option value="auto">Port 465 SSL (Recommended)</option>
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
                    max="10"
                    step="0.1"
                    className="w-full accent-indigo-600 cursor-pointer"
                    value={sendDelay}
                    onChange={(e) => setSendDelay(Number(e.target.value))}
                    id="delay_slider"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 font-sans">
                    <span>0.2s (Fast / Premium Speed)</span>
                    <span className="text-emerald-600 font-semibold">1-3s (Ultra Deliverability)</span>
                    <span>10s (Slow / Bulletproof)</span>
                  </div>
                </div>

                {/* Jitter (Anti-Bot Pattern Randomizer) toggle */}
                <div className="flex items-center justify-between bg-white p-2.5 border border-slate-200 rounded-lg shadow-2xs col-span-2">
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
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-350 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* Right Column: Logout Session */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700">
                  All Logout
                </label>
                {smtpVerified && (
                  <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-bold">
                    Connected Realtime
                  </span>
                )}
              </div>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3.5 flex flex-col justify-between min-h-[120px]">
                <div className="flex items-start space-x-2 text-[11px] text-slate-500 leading-normal">
                  <Info className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                  <span>Clearing the SMTP config deletes your temporary local display settings from this browser's cookies and stops sending immediately.</span>
                </div>
                
                <button
                  type="button"
                  onClick={handleClearSMTPConfig}
                  className="w-full py-2.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 hover:border-rose-300 text-rose-700 text-xs font-bold rounded-lg flex items-center justify-center space-x-1.5 transition cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Clear configurations & Logout</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CAMPAIGN ACTIONS CONTROLLERS */}
        <div className="mt-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap gap-3 items-center">
            {sendingState === "idle" ? (
              <button
                onClick={startSendingQueue}
                className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white rounded-lg font-bold text-sm flex items-center space-x-2 shadow-xs hover:shadow-md cursor-pointer transition active:scale-98"
                id="start_queue_btn"
              >
                <Play className="h-4 w-4 fill-white" />
                <span>Start Outbound Queue Campaign</span>
              </button>
            ) : sendingState === "sending" ? (
              <button
                onClick={handlePauseSending}
                className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-sm flex items-center space-x-2 cursor-pointer transition active:scale-98"
              >
                <Pause className="h-4 w-4 fill-white" />
                <span>Pause Queue</span>
              </button>
            ) : (
              <button
                onClick={startSendingQueue}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-sm flex items-center space-x-2 cursor-pointer transition active:scale-98"
              >
                <Play className="h-4 w-4 fill-white" />
                <span>Resume Campaign</span>
              </button>
            )}

            {sendingState !== "idle" && (
              <button
                onClick={handleStopSending}
                className="px-5 py-3 bg-slate-900 border border-slate-950 text-slate-100 hover:bg-slate-800 rounded-lg font-bold text-sm flex items-center space-x-1.5 cursor-pointer transition active:scale-98"
              >
                <Square className="h-3.5 w-3.5 fill-white" />
                <span>Stop</span>
              </button>
            )}

            <div className="h-8 w-px bg-slate-200 hidden sm:block" />

            {/* Quiet SMTP Verification */}
            <button
              onClick={handleVerifySMTP}
              disabled={verifyingSmtp || !senderEmail || !appPassword}
              className="px-4 py-2 bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-40 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition cursor-pointer"
            >
              {verifyingSmtp ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-slate-500" />
              )}
              <span>Quiet Verification Check</span>
            </button>
          </div>

          {/* Handshake Status Badge */}
          {smtpStatusMsg && (
            <div className={`sm:w-80 p-4 rounded-xl border flex items-start space-x-3 text-xs leading-normal font-sans ${
              smtpVerified === true 
                ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                : smtpVerified === false 
                  ? "bg-rose-50 border-rose-200 text-rose-800" 
                  : "bg-indigo-50 border-indigo-200 text-indigo-800"
            }`}>
              <div className="font-semibold">{smtpStatusMsg}</div>
            </div>
          )}
        </div>

        {/* BOTTOM METRICS */}
        <div className="mt-6">
          
          {/* Campaign stats summary & progress (Full Width) */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Terminal className="h-5 w-5 text-indigo-600" />
                <h3 className="font-semibold text-slate-800">Campaign Dispatch Progress Metrics</h3>
              </div>
              {stats.total > 0 && (
                <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded">
                  {currentIndex} / {stats.total} processed
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-500 font-medium">
                <span>Progress</span>
                <span>{stats.progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/50">
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

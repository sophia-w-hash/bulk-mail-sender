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
  FileSpreadsheet, 
  Layers,
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

export default function App() {
  // SMTP Config Local Persistence
  const [senderName, setSenderName] = useState(() => localStorage.getItem("bulk_sender_name") || "");
  const [senderEmail, setSenderEmail] = useState(() => localStorage.getItem("bulk_sender_email") || "");
  const [appPassword, setAppPassword] = useState(() => localStorage.getItem("bulk_app_password") || "");
  const [showPassword, setShowPassword] = useState(false);

  // Connection settings selection
  const [smtpMode, setSmtpMode] = useState(() => localStorage.getItem("bulk_smtp_mode") || "auto");

  // Email Template Configurations
  const [subjectTemplate, setSubjectTemplate] = useState(
    () => localStorage.getItem("bulk_subject") || "Festival Discount for {name}! ✨"
  );
  const [bodyTemplate, setBodyTemplate] = useState(
    () => localStorage.getItem("bulk_body") || "Hi {name},\n\nWe are excited to share a special bulk discount just for your email: {email}.\n\nThank you for choosing our services!\n\nBest regards,\nYour Marketing Team"
  );

  // Raw Recipients pasting configuration
  const [rawRecipients, setRawRecipients] = useState(
    () => localStorage.getItem("bulk_raw_recipients") || "Aman Kumar, aman.k@example.com\nVijay Sharma, vijay.sharma@example.com\nSneha Patel, sneha.p@example.com"
  );
  const [recipientFileHelp, setRecipientFileHelp] = useState("");

  // Campaign Scheduler State Managers
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = localStorage.getItem("bulk_current_index");
    return saved ? parseInt(saved, 10) : 0;
  });
  const [sendDelay, setSendDelay] = useState(() => {
    const saved = localStorage.getItem("bulk_send_delay");
    return saved ? parseInt(saved, 10) : 3;
  });
  const [useJitter, setUseJitter] = useState(() => localStorage.getItem("bulk_use_jitter") === "true");
  const [sendingState, setSendingState] = useState<"idle" | "sending" | "paused">("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Sync useJitter to localStorage
  useEffect(() => {
    localStorage.setItem("bulk_use_jitter", useJitter ? "true" : "false");
  }, [useJitter]);

  // Sync simple SMTP strings to local memory for comfort reload
  useEffect(() => {
    localStorage.setItem("bulk_sender_name", senderName);
    localStorage.setItem("bulk_sender_email", senderEmail);
    localStorage.setItem("bulk_app_password", appPassword);
    localStorage.setItem("bulk_smtp_mode", smtpMode);
    localStorage.setItem("bulk_subject", subjectTemplate);
    localStorage.setItem("bulk_body", bodyTemplate);
    localStorage.setItem("bulk_raw_recipients", rawRecipients);
    localStorage.setItem("bulk_send_delay", sendDelay.toString());
    localStorage.setItem("bulk_current_index", currentIndex.toString());
  }, [senderName, senderEmail, appPassword, smtpMode, subjectTemplate, bodyTemplate, rawRecipients, sendDelay, currentIndex]);

  // Quick Inline Verification API connection trigger
  const [verifyingSmtp, setVerifyingSmtp] = useState(false);
  const [smtpVerified, setSmtpVerified] = useState<null | boolean>(null);
  const [smtpStatusMsg, setSmtpStatusMsg] = useState("");

  const handleVerifySMTP = async () => {
    if (!senderEmail || !appPassword) {
      setSmtpVerified(false);
      setSmtpStatusMsg("Apna Email id aur 16-character ka App Password enter karein verify karne k liye.");
      return;
    }

    setVerifyingSmtp(true);
    setSmtpVerified(null);
    setSmtpStatusMsg("Connecting with Gmail SMTP Handshake Server...");

    try {
      const response = await fetch("/api/verify-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: senderEmail,
          appPassword: appPassword,
          smtpMode: smtpMode
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSmtpVerified(true);
        setSmtpStatusMsg("Success: SMTP connection authorized! Mails securely linked.");
      } else {
        setSmtpVerified(false);
        setSmtpStatusMsg(data.error || "Handshake rejected. Confirm your 16-Character App Password key.");
      }
    } catch (err: any) {
      setSmtpVerified(false);
      setSmtpStatusMsg("Network error: Could not contact your Node Server.");
    } finally {
      setVerifyingSmtp(false);
    }
  };

  // Recipient Parsing Logic
  const parsedRecipients = useMemo((): Client[] => {
    if (!rawRecipients.trim()) return [];

    return rawRecipients
      .split("\n")
      .map((line, i) => {
        const parts = line.split(/[,\t;]/);
        let name = "";
        let email = "";

        if (parts.length >= 2) {
          name = parts[0].trim();
          email = parts[1].trim();
        } else if (parts.length === 1 && parts[0].includes("@")) {
          email = parts[0].trim();
          name = email.split("@")[0];
        }

        return { email, name, index: i };
      })
      .filter((c) => c.email.includes("@"));
  }, [rawRecipients]);

  // Synchronize dynamic status logs automatically in real-time when idle
  useEffect(() => {
    if (sendingState === "idle") {
      const list: LogEntry[] = parsedRecipients.map((cl, i) => ({
        id: `row-${i}`,
        recipient: cl.email,
        name: cl.name,
        subject: subjectTemplate,
        status: i < currentIndex ? "success" : "pending",
        timestamp: "Waiting...",
      }));
      setLogs(list);
    }
  }, [parsedRecipients, subjectTemplate, sendingState]);

  // Keep a live mutable reference state pointer for intervals to bypass closure freezing on loops
  const isSendingRef = useRef(false);
  const currentIndexRef = useRef(currentIndex);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const handlePauseSending = () => {
    isSendingRef.current = false;
    setSendingState("paused");
  };

  const handleStopSending = () => {
    isSendingRef.current = false;
    setSendingState("idle");
    setCurrentIndex(0);
  };

  const startSendingQueue = () => {
    if (parsedRecipients.length === 0) {
      alert("Pehle valid list of client recipients enter karein.");
      return;
    }
    if (!senderEmail || !appPassword) {
      alert("Verify karein ki aapne sender address aur Gmail App Password daal diya hai.");
      return;
    }

    isSendingRef.current = true;
    setSendingState("sending");

    // Initialize/sync queue execution log tracker
    if (currentIndexRef.current >= parsedRecipients.length) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
    }

    processNextItem();
  };

  const processNextItem = async () => {
    if (!isSendingRef.current) return;
    const indexToProcess = currentIndexRef.current;

    if (indexToProcess >= parsedRecipients.length) {
      setSendingState("idle");
      isSendingRef.current = false;
      alert("Task Completed! Saari emails successfully delivered ho chuki hain.");
      return;
    }

    const currentClient = parsedRecipients[indexToProcess];

    // Helper Spintax Parser
    const parseSpintax = (text: string) => {
      const spintaxPattern = /\{([^{}]+)\}/g;
      return text.replace(spintaxPattern, (match, optionsString) => {
        if (optionsString.includes("|")) {
          const choices = optionsString.split("|");
          return choices[Math.floor(Math.random() * choices.length)];
        }
        return match;
      });
    };

    // Helper to dynamically compile mail variables
    const renderTemplateFull = (template: string, name: string, email: string) => {
      const spintaxProcessed = parseSpintax(template);
      const randomId = "ID-" + Math.random().toString(36).substring(2, 9).toUpperCase();
      const dateLocal = new Date().toLocaleDateString();
      const timeLocal = new Date().toLocaleTimeString();

      return spintaxProcessed
        .replace(/{name}/g, name)
        .replace(/{email}/g, email)
        .replace(/{random_id}/g, randomId)
        .replace(/{date}/g, dateLocal)
        .replace(/{time}/g, timeLocal);
    };

    const renderedSubject = renderTemplateFull(subjectTemplate, currentClient.name, currentClient.email);
    const bodyContentRaw = renderTemplateFull(bodyTemplate, currentClient.name, currentClient.email);
    const bodyContentHtml = bodyContentRaw.replace(/\n/g, "<br />");

    // Update active row log indicator
    setLogs((prev) => 
      prev.map((log, idx) => 
        idx === indexToProcess 
        ? { ...log, status: "sending" as const, timestamp: new Date().toLocaleTimeString() } 
        : log
      )
    );

    try {
      const response = await fetch("/api/send-mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderName,
          senderEmail,
          appPassword,
          recipientEmail: currentClient.email,
          subject: renderedSubject,
          text: bodyContentRaw,
          html: bodyContentHtml,
          smtpMode,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setLogs((prev) => 
          prev.map((log, idx) => 
            idx === indexToProcess 
            ? { ...log, status: "success" as const, timestamp: new Date().toLocaleTimeString() } 
            : log
          )
        );
      } else {
        const errMessage = data.error || "Internal mail dispatcher handshaking rejected.";
        setLogs((prev) => 
          prev.map((log, idx) => 
            idx === indexToProcess 
            ? { ...log, status: "failed" as const, timestamp: new Date().toLocaleTimeString(), error: errMessage } 
            : log
          )
        );
      }
    } catch (err: any) {
      setLogs((prev) => 
        prev.map((log, idx) => 
          idx === indexToProcess 
          ? { ...log, status: "failed" as const, timestamp: new Date().toLocaleTimeString(), error: err.message || "Failed server link" } 
          : log
        )
      );
    }

    // Move to next queue position with adjustable timer delay
    const nextIdx = indexToProcess + 1;
    setCurrentIndex(nextIdx);

    if (nextIdx < parsedRecipients.length && isSendingRef.current) {
      // Calculate delay in milliseconds + random timing jitter factor if toggled
      let actualWait = sendDelay * 1000;
      if (useJitter) {
        const jitterVariance = Math.random() * 2000 - 1000; // adds of subtracts up to 1 second randomly
        actualWait = Math.max(800, actualWait + jitterVariance);
      }
      setTimeout(processNextItem, actualWait);
    } else if (nextIdx >= parsedRecipients.length) {
      setSendingState("idle");
      isSendingRef.current = false;
      alert("Hurray! Campaign successfully delivered completely to all inbox recipients safely!");
    }
  };

  // CSV file uploader parser helper
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setRawRecipients(text);
      setRecipientFileHelp(`Successfully loaded CSV file (${file.name})!`);
    };
    reader.readAsText(file);
  };

  // Formatted statistics to highlight sending outcomes
  const stats = useMemo(() => {
    const total = parsedRecipients.length;
    const sentSuccess = logs.filter(log => log.status === "success").length;
    const sentFailed = logs.filter(log => log.status === "failed").length;
    const sendingCount = logs.filter(log => log.status === "sending").length;
    const pendingCount = Math.max(0, total - sentSuccess - sentFailed);
    const progressPercent = total > 0 ? Math.round(((sentSuccess + sentFailed) / total) * 100) : 0;

    return {
      total,
      sentSuccess,
      sentFailed,
      sendingCount,
      pendingCount,
      progressPercent,
    };
  }, [logs, parsedRecipients]);

  // Command to logout / clear browser credentials
  const handleClearSMTPConfig = () => {
    if (window.confirm("Bhai kya aap sach me apna SMTP clear karke logout hona chahte hain?")) {
      setSenderName("");
      setSenderEmail("");
      setAppPassword("");
      setCurrentIndex(0);
      setSmtpVerified(null);
      setSmtpStatusMsg("");
      localStorage.removeItem("bulk_sender_name");
      localStorage.removeItem("bulk_sender_email");
      localStorage.removeItem("bulk_app_password");
      localStorage.removeItem("bulk_current_index");
      alert("Credentials cleared safely from browser local cache!");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased pb-12">
      {/* 1. Sleek Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl text-white shadow-sm flex items-center justify-center">
              <Mail className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-slate-900 flex items-center space-x-1.5">
                <span>Bulk Mail Sender</span>
              </h1>
              <p className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                Outbound Client SMTP Panel
              </p>
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
                  type={showPassword ? "text" : "password"}
                  className="w-full text-sm font-mono tracking-widest bg-slate-50 border border-slate-200 rounded-lg py-2.5 pl-3.5 pr-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  id="smtp_app_password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
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
                <div className="flex flex-wrap items-center gap-1.5 bg-indigo-50/50 p-1.5 rounded-lg border border-indigo-100">
                  <span className="text-[9px] font-bold text-indigo-700 uppercase tracking-tight">Anti-Spam Code:</span>
                  <button
                    type="button"
                    onClick={() => setBodyTemplate(p => p + " {name}")}
                    className="text-[10px] bg-white hover:bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-mono text-slate-800 font-bold shadow-2xs transition"
                  >
                    +name
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyTemplate(p => p + " {email}")}
                    className="text-[10px] bg-white hover:bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-mono text-slate-800 font-bold shadow-2xs transition"
                  >
                    +email
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyTemplate(p => p + " {random_id}")}
                    className="text-[10px] bg-amber-100/80 hover:bg-amber-200/80 border border-amber-250 px-1.5 py-0.5 rounded font-mono text-amber-900 font-bold shadow-2xs transition"
                    title="Bypasses Gmail duplicate spam filters (Generates custom unique code for every person)."
                  >
                    +unique_id
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyTemplate(p => p + " {date}")}
                    className="text-[10px] bg-white hover:bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-mono text-slate-800 font-bold shadow-2xs transition"
                  >
                    +date
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyTemplate(p => p + " {time}")}
                    className="text-[10px] bg-white hover:bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-mono text-slate-800 font-bold shadow-2xs transition"
                  >
                    +time
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyTemplate(p => p + " {Hi|Hello|Hey}")}
                    className="text-[10px] bg-emerald-100/80 hover:bg-emerald-250/80 border border-emerald-250 px-1.5 py-0.5 rounded font-mono text-emerald-900 font-bold shadow-2xs transition"
                    title="Spintax format: Randomly chooses one option per email."
                  >
                    +spintax
                  </button>
                </div>
              </div>
              <textarea
                rows={8}
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white leading-relaxed resize-y font-sans"
                placeholder="Write message here..."
                value={bodyTemplate}
                onChange={(e) => setBodyTemplate(e.target.value)}
                id="mail_body"
              />
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
                    <span>Interval delay: {sendDelay}s per email</span>
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
                    min="1"
                    max="12"
                    step="1"
                    className="w-full accent-indigo-600 cursor-pointer"
                    value={sendDelay}
                    onChange={(e) => setSendDelay(Number(e.target.value))}
                    id="delay_slider"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400">
                    <span>1s (Bohot Tez)</span>
                    <span className="text-amber-600 font-semibold">3-5s (Safe range)</span>
                    <span>12s (Slow & Safe)</span>
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

            {/* Right Column: Logout Session */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700">
                  All Logout
                </label>
                <button
                  type="button"
                  onClick={handleVerifySMTP}
                  disabled={verifyingSmtp || !senderEmail || !appPassword}
                  className="text-xs text-indigo-600 hover:underline font-bold disabled:text-slate-400"
                  id="verify_quick_trigger"
                >
                  {verifyingSmtp ? "Verifying..." : "Verify Connection Link"}
                </button>
              </div>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3.5 flex flex-col justify-between min-h-[178px]">
                <div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Apne email credentials ko fully temporary browser cache se clear karne k liye Logout dabayein.
                  </p>
                </div>

                {/* Action Button: Clear/Logout Credentials */}
                <div className="space-y-2">
                  <button
                    onClick={handleClearSMTPConfig}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 border border-rose-200 hover:border-rose-300 rounded-lg font-bold text-sm transition cursor-pointer active:scale-98"
                    id="clear_smtp_btn"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>All Logout</span>
                  </button>

                  {/* Real-time verification notice feed */}
                  {smtpStatusMsg && (
                    <div className={`text-xs font-semibold flex items-start space-x-1.5 p-2 rounded-lg border ${
                      smtpVerified === true ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-rose-50 text-rose-800 border-rose-200"
                    }`}>
                      <div className="mt-0.5 shrink-0">
                        {smtpVerified === true ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-rose-600" />
                        )}
                      </div>
                      <div className="leading-tight text-[11px]">
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

    </div>
  );
}

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
  const [senderName, setSenderName] = useState(() => localStorage.getItem("bulk_sender_name") || "");
  const [senderEmail, setSenderEmail] = useState(() => localStorage.getItem("bulk_sender_email") || "");
  const [appPassword, setAppPassword] = useState(() => localStorage.getItem("bulk_smtp_pass") || "");
  const [smtpMode, setSmtpMode] = useState(() => localStorage.getItem("bulk_smtp_mode") || "auto");
  const [showPassword, setShowPassword] = useState(false);
  const [smtpVerified, setSmtpVerified] = useState<boolean | null>(null);
  const [verifyingSmtp, setVerifyingSmtp] = useState(false);
  const [smtpStatusMsg, setSmtpStatusMsg] = useState("");

  const [rawRecipients, setRawRecipients] = useState(
    "Aman Kumar, aman.k@example.com\nVijay Sharma, vijay.sharma@example.com\nSneha Patel, sneha.p@example.com"
  );
  const [recipientFileHelp, setRecipientFileHelp] = useState("");

  const [subjectTemplate, setSubjectTemplate] = useState("Festival Discount for {name}! ✨");
  const [bodyTemplate, setBodyTemplate] = useState(
    "Hi {name},\n\nWe are excited to share a special bulk discount just for your email: {email}.\n\nThank you for choosing our services!\n\nBest regards,\nYour Marketing Team"
  );

  const [sendDelay, setSendDelay] = useState(3);
  const [sendingState, setSendingState] = useState<"idle" | "sending" | "paused">("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed" | "pending">("all");
  const [showHelpModal, setShowHelpModal] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const isSendingRef = useRef<boolean>(false);
  const sendingStateRef = useRef<"idle" | "sending" | "paused">("idle");
  const delayTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    sendingStateRef.current = sendingState;
    isSendingRef.current = sendingState === "sending";
  }, [sendingState]);

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

  useEffect(() => {
    setSmtpVerified(null);
    setSmtpStatusMsg("");
  }, [senderName, senderEmail, appPassword, smtpMode]);

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

  const parsedRecipients = useMemo((): Client[] => {
    if (!rawRecipients.trim()) return [];
    
    return rawRecipients
      .split("\n")
      .map((line, idx) => {
        const cleaned = line.trim();
        if (!cleaned) return null;

        if (cleaned.includes(",")) {
          const parts = cleaned.split(",");
          const name = parts[0]?.trim() || "";
          const email = parts[1]?.trim() || "";
          if (email.includes("@")) {
            return { name, email, index: idx };
          }
        }

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

  const livePreview = useMemo(() => {
    const demoClient = parsedRecipients[0] || { name: "[Client Name]", email: "client@example.com", index: 0 };
    
    const renderTemplate = (tmpl: string) => {
      return tmpl
        .replace(/{name}/g, demoClient.name)
        .replace(/{email}/g, demoClient.email);
    };

    return {
      to: demoClient.email,
      name: demoClient.name,
      subject: renderTemplate(subjectTemplate),
      body: renderTemplate(bodyTemplate),
    };
  }, [parsedRecipients, subjectTemplate, bodyTemplate]);

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
        setSmtpStatusMsg(data.error || "Verification failed. Check your App Password.");
      }
    } catch (err: any) {
      setSmtpVerified(false);
      setSmtpStatusMsg(err.message || "Failed to make verify network request. Check connection.");
    } finally {
      setVerifyingSmtp(false);
    }
  };

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

  const startSendingQueue = async () => {
    if (!senderEmail || !appPassword) {
      alert("Please enter Sender Gmail and 16-digit App Password first.");
      return;
    }
    if (parsedRecipients.length === 0) {
      alert("No valid recipient emails found.");
      return;
    }

    if (smtpVerified !== true) {
      const isOk = await checkSmtpQuietly();
      if (!isOk) {
        const goOn = window.confirm(
          `Warning: SMTP Connection check failed. Do you want to try sending anyway?`
        );
        if (!goOn) return;
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

  const processNextItem = async (indexToProcess: number) => {
    if (!isSendingRef.current || indexToProcess >= parsedRecipients.length) {
      if (indexToProcess >= parsedRecipients.length) {
        setSendingState("idle");
        isSendingRef.current = false;
        alert("🎉 Done! All bulk emails processed successfully.");
      }
      return;
    }

    const currentClient = parsedRecipients[indexToProcess];
    setCurrentIndex(indexToProcess);

    setLogs((prev) => 
      prev.map((log, idx) => 
        idx === indexToProcess ? { ...log, status: "sending", timestamp: "Sending..." } : log
      )
    );

    const customSubject = subjectTemplate
      .replace(/{name}/g, currentClient.name)
      .replace(/{email}/g, currentClient.email);

    const customBody = bodyTemplate
      .replace(/{name}/g, currentClient.name)
      .replace(/{email}/g, currentClient.email);

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
        }),
      });

      const data = await response.json();

      if (data.success) {
        setLogs((prev) => 
          prev.map((log, idx) => 
            idx === indexToProcess 
              ? { ...log, status: "success", timestamp: new Date().toLocaleTimeString(), error: undefined } 
              : log
          )
        );
      } else {
        setLogs((prev) => 
          prev.map((log, idx) => 
            idx === indexToProcess 
              ? { 
                  ...log, 
                  status: "failed", 
                  timestamp: new Date().toLocaleTimeString(),
                  error: data.error || "Rejected by Google SMTP." 
                } 
              : log
          )
        );
      }
    } catch (err: any) {
      setLogs((prev) => 
        prev.map((log, idx) => 
          idx === indexToProcess 
            ? { 
                ...log, 
                status: "failed", 
                timestamp: new Date().toLocaleTimeString(),
                error: err.message || "Network connection failed." 
              } 
            : log
        )
      );
    }

    const nextIdx = indexToProcess + 1;
    setCurrentIndex(nextIdx);

    if (nextIdx < parsedRecipients.length && isSendingRef.current) {
      delayTimerRef.current = setTimeout(() => {
        processNextItem(nextIdx);
      }, sendDelay * 1000);
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

  const clearLogsConsole = () => {
    setLogs([]);
    setCurrentIndex(0);
  };

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

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = 
        log.recipient.toLowerCase().includes(searchFilter.toLowerCase()) ||
        log.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        log.subject.toLowerCase().includes(searchFilter.toLowerCase());

      const matchesStatus = 
        statusFilter === "all" || 
        log.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [logs, searchFilter, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased pb-12">
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-6">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Settings className="h-5 w-5 text-indigo-600" />
              <h2 className="font-bold text-slate-800 text-lg">Campaign Control Panel</h2>
            </div>
          </div>

          {/* ROW 1 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="block text-sm font-bold text-slate-700" htmlFor="sender_name_input">
                Sender Name
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

            <div className="space-y-1">
              <label className="block text-sm font-bold text-slate-700" htmlFor="smtp_sender_email">
                Your Gmail
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

          {/* ROW 2 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700" htmlFor="smtp_app_password">
                  App Password
                </label>
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

            <div className="space-y-1">
              <label className="block text-sm font-bold text-slate-700" htmlFor="mail_subject">
                Subject
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

          {/* ROW 3 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700" htmlFor="mail_body">
                  Message Body
                </label>
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
                placeholder="Aman Kumar, aman@example.com"
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

          {/* ROW 4 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div className="space-y-1">
              <label className="block text-sm font-bold text-slate-700">Send</label>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700">
                    <Clock className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Interval delay: {sendDelay}s per email</span>
                  </div>
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
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {sendingState !== "sending" ? (
                    <button
                      onClick={startSendingQueue}
                      disabled={parsedRecipients.length === 0}
                      className="col-span-2 flex items-center justify-center space-x-2 py-3 rounded-lg font-bold text-sm text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300"
                    >
                      <Play className="h-4 w-4 fill-white text-white shrink-0" />
                      <span>{sendingState === "paused" ? "Resume" : "Send"}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseSending}
                      className="col-span-2 flex items-center justify-center space-x-2 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold text-sm"
                    >
                      <Pause className="h-4 w-4 fill-white text-white shrink-0" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    onClick={handleStopSending}
                    disabled={sendingState === "idle" && currentIndex === 0}
                    className="flex items-center justify-center space-x-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold font-mono"
                  >
                    <Square className="h-3.5 w-3.5 fill-slate-700 shrink-0 text-slate-700" />
                    <span>Stop</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700">Logout</label>
                <button
                  type="button"
                  onClick={handleVerifySMTP}
                  className="text-xs text-indigo-600 hover:underline font-bold"
                >
                  Verify Connection
                </button>
              </div>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3.5 flex flex-col justify-between min-h-[178px]">
                <p className="text-xs text-slate-600">
                  Apne credentials wipe karne ke liye Logout dabayein.
                </p>

                <div className="space-y-2">
                  <button
                    onClick={handleClearSMTPConfig}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-bold text-sm"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>All Logout</span>
                  </button>

                  {smtpStatusMsg && (
                    <div className={`text-xs font-semibold flex items-start space-x-1.5 p-2 rounded-lg border ${
                      smtpVerified === true ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-rose-50 text-rose-800 border-rose-200"
                    }`}>
                      <span className="leading-tight text-[11px]">{smtpStatusMsg}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* METRICS & PREVIEW */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6 items-start">
          <section className="lg:col-span-5 bg-slate-900 text-slate-100 rounded-xl p-5">
            <h3 className="font-semibold text-sm mb-3">Live Parse Preview</h3>
            <div className="space-y-3.5 text-xs font-mono">
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex">
                <span className="text-slate-500 font-bold uppercase w-16 shrink-0">From:</span> 
                <span className="text-slate-300 truncate">{senderName ? `"${senderName}" <${senderEmail}>` : senderEmail || "..."}</span>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex">
                <span className="text-slate-500 font-bold uppercase w-16">To:</span> 
                <span className="text-slate-300 truncate">{livePreview.to}</span>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex">
                <span className="text-slate-500 font-bold uppercase w-16">Subject:</span> 
                <span className="text-indigo-400 truncate">{livePreview.subject}</span>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 whitespace-pre-wrap leading-relaxed text-slate-300 min-h-[140px] text-[11px]">
                {livePreview.body}
              </div>
            </div>
          </section>

          <section className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h3 className="font-semibold text-slate-800">Campaign Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span>Progress Bar</span>
                <span className="font-mono font-bold">{stats.progressPercent}% Completed</span>
              </div>
              <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden border border-slate-200 p-0.5">
                <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${stats.progressPercent}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-slate-50 border p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400">SUCCESS</div>
                <div className="text-xl font-bold text-emerald-600 font-mono">{stats.sentSuccess}</div>
              </div>
              <div className="bg-slate-50 border p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400">ERRORS</div>
                <div className="text-xl font-bold text-rose-600 font-mono">{stats.sentFailed}</div>
              </div>
              <div className="bg-slate-50 border p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400">PENDING</div>
                <div className="text-xl font-bold text-amber-600 font-mono">{stats.pendingCount}</div>
              </div>
              <div className="bg-slate-50 border p-3 rounded-lg">
                <div className="text-[10px] font-bold text-slate-400">TOTAL</div>
                <div className="text-xl font-bold text-indigo-600 font-mono">{stats.total}</div>
              </div>
            </div>
          </section>
        </div>

        {/* EXECUTION LOGS CONSOLE */}
        <div className="mt-6">
          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-bold text-slate-800">Campaign Execution Logs Console</h3>
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-2 font-mono">
                <Terminal className="h-8 w-8 text-slate-300" />
                <span>Console active. Connect SMTP to watch...</span>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 mt-4">
                <table className="min-w-full divide-y divide-slate-150 text-left text-xs font-mono">
                  <thead className="bg-slate-50 text-slate-500 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Index</th>
                      <th className="py-3 px-4">Client</th>
                      <th className="py-3 px-4">Rendered Subject</th>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 bg-white">
                    <AnimatePresence initial={false}>
                      {filteredLogs.map((log, listIndex) => (
                        <motion.tr
                          key={log.id}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="hover:bg-slate-50"
                        >
                          <td className="py-3 px-4 text-slate-400">{listIndex + 1}</td>
                          <td className="py-3 px-4 font-bold text-slate-700">{log.name}</td>
                          <td className="py-3 px-4 text-slate-600 truncate max-w-xs">{log.subject}</td>
                          <td className="py-3 px-4 text-slate-400">{log.timestamp}</td>
                          <td className="py-3 px-4">
                            {log.status === "success" && <span className="text-emerald-600 font-bold">Delivered</span>}
                            {log.status === "failed" && <span className="text-rose-600 font-bold">Failed</span>}
                            {log.status === "sending" && <span className="text-indigo-600">Sending...</span>}
                            {log.status === "pending" && <span className="text-slate-400">Pending</span>}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {log.error ? <span className="text-rose-500 text-[10px]">Error: {log.error}</span> : log.status === "success" ? <span className="text-emerald-500">Sent</span> : "—"}
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>

      <AnimatePresence>
        {showHelpModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={() => setShowHelpModal(false)} />
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative transform overflow-hidden rounded-xl bg-white text-left shadow-xl transition-all w-full max-w-lg border border-slate-200 p-5"
              >
                <div className="flex justify-between items-center pb-3 border-b">
                  <h3 className="font-bold">App Password Settings</h3>
                  <button onClick={() => setShowHelpModal(false)} className="text-slate-405 font-bold cursor-pointer">✕</button>
                </div>
                <div className="space-y-4 pt-4 text-xs">
                  <p>1. Go to your Google Account Settings > Security.</p>
                  <p>2. Enable 2-Step Verification.</p>
                  <p>3. Generate an "App Password", copy the yellow 16-character code, and paste it here.</p>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

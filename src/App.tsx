import React, { useState, useEffect, useMemo, useRef, ChangeEvent } from "react";
import { 
  Mail, 
  Send, 
  Play, 
  Pause, 
  Eye, 
  EyeOff, 
  ShieldCheck,
  Users,
  FileSpreadsheet
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

export default function App() {
  // Launcher passcode lock states (Passcode to unlock is 6395)
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("bulk_app_auth") === "true" || localStorage.getItem("bulk_app_auth") === "true";
  });
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");

  // SMTP Credentials
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Email Subject and Body templates
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");

  // Recipients input
  const [rawRecipients, setRawRecipients] = useState("");

  // Turnstile simulated success state (starts loading, resolves to Success after mount)
  const [turnstileState, setTurnstileState] = useState<"loading" | "success">("loading");

  // Log lists and current send index state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sendingState, setSendingState] = useState<"idle" | "sending" | "paused">("idle");

  // Delay interval per email (adjustable by user, defaults to 5.0 seconds for high inboxing probability)
  const [sendDelay, setSendDelay] = useState<number>(5.0);
  const sendDelayRef = useRef<number>(5.0);

  useEffect(() => {
    sendDelayRef.current = sendDelay;
  }, [sendDelay]);

  // Reference hooks for the send queue loop
  const isSendingRef = useRef<boolean>(false);
  const sendingStateRef = useRef<"idle" | "sending" | "paused">("idle");
  const activeTimersRef = useRef<Set<any>>(new Set());

  // Cloudflare Turnstile simulation on load
  useEffect(() => {
    const timer = setTimeout(() => {
      setTurnstileState("success");
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Synchronize state values
  useEffect(() => {
    sendingStateRef.current = sendingState;
    isSendingRef.current = sendingState === "sending";
  }, [sendingState]);

  // Parse list of recipients pasted into textarea
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

  // Personalization rendering
  const renderTemplateFull = (template: string, clientName: string, clientEmail: string): string => {
    let result = parseSpintax(template);
    result = result
      .replace(/{name}/g, clientName)
      .replace(/{email}/g, clientEmail);
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
      const currentClient = parsedRecipients[indexToProcess];

      setLogs((prev) => 
        prev.map((log, idx) => 
          idx === indexToProcess ? { ...log, status: "sending", timestamp: "Sending..." } : log
        )
      );

      // Render templates
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
            smtpMode: "auto",
            htmlLayout: "raw", // Pure Text for safe inbox delivery
            useAutoUnsubscribe: false,
            useAntiSpamFootprint: false,
            useZeroWidthPadding: false,
            useSubjectVariant: false,
            randomUnsubId: ""
          }),
        });

        const data = await response.json();

        if (data.success) {
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
          setLogs((prev) => 
            prev.map((log, idx) => 
              idx === indexToProcess 
                ? { 
                    ...log, 
                    status: "failed", 
                    subject: customSubject,
                    timestamp: new Date().toLocaleTimeString(),
                    error: data.error || "Rejected by Gmail server." 
                  } 
                : log
            )
          );
          return false;
        }
      } catch (err: any) {
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
        return false;
      }
    };

    const runDispatchLoop = async () => {
      while (isSendingRef.current && nextIndexToProcess < parsedRecipients.length) {
        const indexToProcess = nextIndexToProcess;
        nextIndexToProcess += 1;
        setCurrentIndex(nextIndexToProcess);

        const success = await processSingleItem(indexToProcess);
        
        if (nextIndexToProcess < parsedRecipients.length && isSendingRef.current) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              activeTimersRef.current.delete(timer);
              resolve();
            }, sendDelayRef.current * 1000);
            activeTimersRef.current.add(timer);
          });
        }
      }

      setSendingState("idle");
      isSendingRef.current = false;
    };

    runDispatchLoop();
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

  // Counters for Progress Monitor
  const totalRecipients = parsedRecipients.length;
  const sentCount = useMemo(() => logs.filter(l => l.status === "success").length, [logs]);
  const failedCount = useMemo(() => logs.filter(l => l.status === "failed").length, [logs]);
  const remainingCount = useMemo(() => {
    if (logs.length === 0) return totalRecipients;
    const processed = logs.filter(l => l.status === "success" || l.status === "failed").length;
    return Math.max(0, totalRecipients - processed);
  }, [logs, totalRecipients]);

  const sendingPercent = totalRecipients > 0 ? Math.round((currentIndex / totalRecipients) * 100) : 0;

  // Render Passcode gates if not authenticated
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased pb-12">
      {/* Top Brand Header */}
      <div className="flex flex-col items-center justify-center pt-8 pb-3">
        <div className="flex items-center space-x-2 text-indigo-600 font-bold text-2xl tracking-wide select-none">
          <ShieldCheck className="h-7 w-7" />
          <span>Secure Mail Console</span>
        </div>
      </div>

      {/* Main Two-Column Layout Workspace */}
      <main className="max-w-5xl mx-auto px-4 mt-4">
        
        {/* Bulk Email Sender Heading */}
        <div className="flex items-center space-x-2 mb-4">
          <Send className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-800">Bulk Email Sender</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* LEFT COLUMN: Compose Message */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
            <div className="border-b border-slate-100 pb-3 flex items-center space-x-2">
              <Mail className="h-5 w-5 text-indigo-600" />
              <h2 className="font-bold text-slate-800 text-base">Compose Message</h2>
            </div>

            <div className="space-y-4">
              {/* Row 1: Sender Name & Your Gmail */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 font-sans">Sender Name</label>
                  <input
                    type="text"
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
                    placeholder="E.g., John Doe"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 font-sans">Your Gmail</label>
                  <input
                    type="email"
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
                    placeholder="you@gmail.com"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: Email Subject & App Password */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 font-sans">Email Subject</label>
                  <input
                    type="text"
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800"
                    placeholder="Enter subject line..."
                    value={subjectTemplate}
                    onChange={(e) => setSubjectTemplate(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 font-sans">App Password</label>
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

              {/* Message Body (Plain Text) */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">Message Body (Plain Text)</label>
                <textarea
                  rows={8}
                  className="w-full text-sm rounded-lg p-3 focus:outline-none transition-all duration-300 leading-relaxed font-sans resize-y bg-slate-50 border border-slate-200 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  placeholder="Write your email here..."
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                />
              </div>

              {/* Spam Protection Turnstile Layout */}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex items-center space-x-1 text-slate-500">
                  <ShieldCheck className="h-4 w-4" />
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
                        <div className="h-5 w-5 bg-[#0fa370] text-white rounded-full flex items-center justify-center">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="text-xs font-extrabold text-[#111]">Success!</span>
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

                <div className="border border-red-300 bg-red-50 text-red-700 rounded p-1 px-2 text-[10px] font-semibold tracking-tight w-full max-w-sm leading-none block text-left">
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
                  placeholder={`john@example.com\njane@example.com`}
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

              {/* Sending Speed/Delay Control */}
              <div className="space-y-1.5 bg-slate-50 border border-slate-100 rounded-xl p-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-700">Sending Delay (सेंडिंग डिले)</span>
                  <span className="font-mono text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                    {sendDelay}s / email
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="20"
                  step="0.5"
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  value={sendDelay}
                  onChange={(e) => setSendDelay(parseFloat(e.target.value))}
                />
                <div className="flex justify-between text-[11px] text-slate-400 font-semibold leading-none">
                  <span>0.5s (Fast)</span>
                  <span className="text-emerald-600 font-bold">5s - 10s (Inbox Safe ⭐)</span>
                  <span>20s (Very Safe)</span>
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

              {/* Status Indicator */}
              <div className="flex justify-center items-center py-2 bg-slate-50 rounded-lg border border-slate-100">
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

              {/* Primary Actions Button */}
              <div className="flex gap-2">
                <button
                  onClick={sendingState === "sending" ? handlePauseSending : startSendingQueue}
                  disabled={totalRecipients === 0}
                  className={`w-full py-3.5 rounded-xl font-bold text-sm text-white transition flex items-center justify-center space-x-2 cursor-pointer shadow-xs ${
                    totalRecipients === 0 
                    ? "bg-slate-350 text-slate-500 cursor-not-allowed"
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
                    className="px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-sm rounded-xl transition cursor-pointer"
                    title="Reset Statistics"
                  >
                    Reset
                  </button>
                )}
              </div>

            </div>

            {/* 🛡️ Inbox Placement Helper Tips */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-2 text-xs text-emerald-900 shadow-3xs mt-2">
              <div className="flex items-center space-x-1.5 font-extrabold text-emerald-950 border-b border-emerald-200/50 pb-2">
                <ShieldCheck className="h-4.5 w-4.5 text-emerald-600 flex-shrink-0" />
                <span>100% Inbox Delivery Guidance (सैम रोकने के टिप्स)</span>
              </div>
              <ul className="list-disc pl-4 space-y-2 text-[11px] leading-relaxed text-emerald-900 font-medium">
                <li>
                  <strong className="text-emerald-950">Spintax (स्पिनटैक्स रैंडम):</strong> Use templates like <code className="bg-white px-1 py-0.5 rounded text-emerald-950 font-mono font-bold">{"{Hello|Hi|Dear}"}</code> in your Subject or Body. This automatically alternates greetings so every single email is unique and bypasses Gmail’s spam filters.
                </li>
                <li>
                  <strong className="text-emerald-950">No Links (कोई लिंक न जोड़ें):</strong> As requested, do not add links or buttons to the subject or body to avoid triggering security hash blocks.
                </li>
                <li>
                  <strong className="text-emerald-950">Slow Sending Delay (धीमी सेंडिंग प्रक्रिया):</strong> Increase the <strong className="text-emerald-950">Sending Delay to 5s - 10s</strong>. Sending emails too fast (e.g. 0.5s) will make Gmail trigger an automated anti-bot limit and mark the entire batch as spam immediately.
                </li>
                <li>
                  <strong className="text-emerald-950">Personalize with tags:</strong> Add <code className="bg-white px-1 py-0.5 rounded text-emerald-950 font-mono font-bold">{"{name}"}</code> or <code className="bg-white px-1 py-0.5 rounded text-emerald-950 font-mono font-bold">{"{email}"}</code> to make the text specific to the user.
                </li>
              </ul>
            </div>

            {/* Clean, Non-obtrusive list with logs details */}
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
    </div>
  );
}

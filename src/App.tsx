// Core State for Delay interval (in src/App.tsx)
const [sendDelay, setSendDelay] = useState(5.0); // default 5.0 seconds throttle/delay for safe inbox delivery

// Safe single worker dispatcher (in src/App.tsx -> handleStartSending)
const handleStartSending = async () => {
  if (!senderEmail || !appPassword) {
    setErrorModalTitle("Missing Identity Credentials");
    setErrorModalMessage("Please establish your Google Account Sender Email and 16-digit App Password on the left sidebar before broadcasting.");
    setErrorModalOpen(true);
    return;
  }

  if (parsedRecipients.length === 0) {
    alert("Please establish or upload a valid recipient list before attempting a broadcast campaign.");
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

  // 1-by-1 sequential worker ensures natural human pacing to bypass automated spam triggers!
  const concurrency = 1; 
  let nextIndexToProcess = startIndex;
  let activeWorkersCount = 0;

  const processSingleItem = async (indexToProcess: number): Promise<boolean> => {
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
          html: customBody.replace(/\n/g, "<br>"),
          smtpMode,
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

  const runWorker = async () => {
    activeWorkersCount++;
    while (isSendingRef.current) {
      if (nextIndexToProcess >= parsedRecipients.length) {
        break;
      }
      const indexToProcess = nextIndexToProcess;
      nextIndexToProcess++;
      setCurrentIndex(nextIndexToProcess);

      const success = await processSingleItem(indexToProcess);
      if (!success || !isSendingRef.current) {
        break;
      }

      if (nextIndexToProcess < parsedRecipients.length && isSendingRef.current) {
        let finalDelayMs = sendDelay * 1000;
        if (useJitter) {
          const randomModifier = (Math.random() * 4 - 1.5) * 1000;
          finalDelayMs = Math.max(1000, finalDelayMs + randomModifier);
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
    activeWorkersCount--;

    if (activeWorkersCount === 0) {
      setSendingState("idle");
      if (nextIndexToProcess >= parsedRecipients.length && isSendingRef.current) {
        alert("🎉 Done! All bulk emails processed successfully.");
      }
    }
  };

  const activeWorkers = Math.min(concurrency, parsedRecipients.length - startIndex);
  for (let i = 0; i < activeWorkers; i++) {
    runWorker();
  }
};

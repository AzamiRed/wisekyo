function formatErrorDetails(error) {
  if (!error) return null;
  if (typeof error === "string") return error;
  const stack = error.stack || "";
  const extra = error.code ? `code=${error.code}` : "";
  return [error.message, extra, stack].filter(Boolean).join("\n").slice(0, 20000);
}

function createLogger(repository) {
  async function write(level, source, message, details) {
    const text = String(message || "Unknown event");
    const detailText =
      details == null
        ? null
        : typeof details === "string" || details instanceof Error
          ? formatErrorDetails(details)
          : String(details);

    if (level === "error") console.error(`[${source}] ${text}`, details || "");
    else if (level === "warn") console.warn(`[${source}] ${text}`, details || "");
    else console.log(`[${source}] ${text}`);

    if (!repository?.insertLog) return;
    try {
      await repository.insertLog({
        level,
        source,
        message: text,
        details: detailText,
      });
    } catch (error) {
      console.error("Failed to persist log entry:", error);
    }
  }

  return {
    info: (source, message, details) => write("info", source, message, details),
    warn: (source, message, details) => write("warn", source, message, details),
    error: (source, message, details) => write("error", source, message, details),
  };
}

module.exports = { createLogger, formatErrorDetails };

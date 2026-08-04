/** Push a notification via ntfy. No-op when NTFY_TOPIC is unset. */
export async function notify(
  title: string,
  message: string,
  opts: { priority?: "min" | "low" | "default" | "high" | "urgent"; tags?: string } = {}
): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const server = process.env.NTFY_SERVER ?? "https://ntfy.sh";
  try {
    await fetch(`${server}/${topic}`, {
      method: "POST",
      body: message,
      headers: {
        Title: title,
        Priority: opts.priority ?? "default",
        ...(opts.tags ? { Tags: opts.tags } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("ntfy notification failed:", e);
  }
}

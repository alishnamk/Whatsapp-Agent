// Next.js calls register() once when the server process starts.
// We use it to kick off the monthly receipts-report cron job.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  // Only run in the actual Node.js server process — not in the edge
  // runtime or during the build step.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}

import cron from "node-cron";
import path from "path";

import { getSupabaseServerClient } from "./supabase";
import { buildMonthlyReport } from "./reports";
import {
  uploadWhatsAppOutgoingMedia,
  sendWhatsAppDocumentTemplate,
} from "./whatsapp";

// Default: 9am on the 1st of every month. Override with
// REPORT_CRON_SCHEDULE (standard 5-field cron syntax) if you want a
// different time.
const CRON_SCHEDULE = process.env.REPORT_CRON_SCHEDULE || "0 9 1 * *";

const DEFAULT_UPLOADS_ROOT = path.join(process.cwd(), "uploads");

async function getUploadsRoot(): Promise<string> {
  try {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "media_storage_path")
      .maybeSingle();

    return data?.value || DEFAULT_UPLOADS_ROOT;
  } catch {
    return DEFAULT_UPLOADS_ROOT;
  }
}

/*
 * Build the report for the PREVIOUS calendar month and send it via
 * WhatsApp. Runs the same logic whether it fires from the cron
 * schedule or a manual trigger (see /api/reports/generate).
 */
export async function runMonthlyReportJob(): Promise<{
  ok: boolean;
  message: string;
  filePath?: string;
}> {
  const now = new Date();

  // "Previous month" — if this runs on the 1st, we're reporting on
  // the month that just finished, not the one that just started.
  const targetMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const targetYear =
    now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const uploadsRoot = await getUploadsRoot();

  console.log(
    `[reports] Building report for ${targetYear}-${targetMonth}...`
  );

  const report = await buildMonthlyReport(
    uploadsRoot,
    targetYear,
    targetMonth
  );

  console.log(
    `[reports] Report built: ${report.filePath} (${report.totalCount} receipts, ${report.needsReviewCount} need review)`
  );

  const to = process.env.REPORT_WHATSAPP_TO;
  const templateName = process.env.WHATSAPP_REPORT_TEMPLATE_NAME;

  if (!to || !templateName) {
    const msg =
      "[reports] REPORT_WHATSAPP_TO or WHATSAPP_REPORT_TEMPLATE_NAME not set — report was built but not sent.";
    console.warn(msg);
    return { ok: true, message: msg, filePath: report.filePath };
  }

  const mediaId = await uploadWhatsAppOutgoingMedia(
    report.filePath,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  if (!mediaId) {
    const msg = "[reports] Failed to upload report to WhatsApp.";
    console.error(msg);
    return { ok: false, message: msg, filePath: report.filePath };
  }

  const filename = path.basename(report.filePath);

  const sendResult = await sendWhatsAppDocumentTemplate(
    to,
    templateName,
    mediaId,
    filename,
    report.monthLabel
  );

  if (!sendResult.ok) {
    const msg = `[reports] Failed to send report via WhatsApp: ${JSON.stringify(
      sendResult.body
    )}`;
    console.error(msg);
    return { ok: false, message: msg, filePath: report.filePath };
  }

  const msg = `[reports] Sent ${report.monthLabel} report to ${to} (${report.totalCount} receipts, ${report.needsReviewCount} need review).`;
  console.log(msg);
  return { ok: true, message: msg, filePath: report.filePath };
}

// Prevents double-scheduling when Next.js's dev server hot-reloads
// this module — without this guard you'd get the job registered
// (and later firing) multiple times.
declare global {
  // eslint-disable-next-line no-var
  var __receiptsSchedulerStarted: boolean | undefined;
}

export function startScheduler(): void {
  if (global.__receiptsSchedulerStarted) {
    return;
  }

  global.__receiptsSchedulerStarted = true;

  cron.schedule(CRON_SCHEDULE, () => {
    runMonthlyReportJob().catch((err) => {
      console.error("[reports] Scheduled job failed:", err);
    });
  });

  console.log(
    `[reports] Monthly report scheduler started (cron: "${CRON_SCHEDULE}").`
  );
}

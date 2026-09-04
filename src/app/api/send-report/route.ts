import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import { getSupabaseServerClient } from "@/lib/supabase";
import {
  getLocalUploadsRoot,
  uploadWhatsAppOutgoingMedia,
  sendWhatsAppDocumentMessage,
} from "@/lib/whatsapp";

// This endpoint is NOT for the WhatsApp bot itself — it's a one-way
// door for an external tool (e.g. Claude Cowork, running the monthly
// report job on your laptop) to hand off a finished report file so
// this app can deliver it over WhatsApp using the credentials it
// already has.
//
// Example usage (what Cowork/curl calls):
//   curl -X POST https://<your-deployment>/api/send-report \
//     -H "Authorization: Bearer <REPORT_UPLOAD_SECRET>" \
//     -F "file=@Receipts-Report-August-2026.xlsx"

export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.REPORT_UPLOAD_SECRET;

  if (!expected) {
    // Fail closed: if no secret is configured, nobody gets in. This
    // stops the endpoint from accidentally being wide open just
    // because someone forgot to set the env var.
    return false;
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return Boolean(match && match[1] === expected);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const formData = await req.formData().catch(() => null);

  const file = formData?.get("file");

  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "Missing 'file' field in the upload" },
      { status: 400 }
    );
  }

  // Who to send it to — configured in the dashboard's Settings modal,
  // not hardcoded, so it can be changed without redeploying.
  const supabase = getSupabaseServerClient();

  const { data: settingRow, error: settingError } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "report_recipient_number")
    .maybeSingle();

  if (settingError) {
    return NextResponse.json(
      { error: `Could not read report recipient setting: ${settingError.message}` },
      { status: 500 }
    );
  }

  const recipient = settingRow?.value;

  if (!recipient) {
    return NextResponse.json(
      {
        error:
          "No report recipient configured yet. Set one in the dashboard's Settings modal first.",
      },
      { status: 400 }
    );
  }

  const filename = file.name || "report.xlsx";
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType =
    file.type ||
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  // Save a local copy alongside everything else this app manages, so
  // it shows up on disk the same way receipts do.
  const uploadsRoot = await getLocalUploadsRoot(supabase);
  const reportsDir = path.join(uploadsRoot, "reports");

  let savedPath: string;

  try {
    await fs.mkdir(reportsDir, { recursive: true });
    savedPath = path.join(reportsDir, filename);
    await fs.writeFile(savedPath, buffer);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to save the incoming file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }

  const mediaId = await uploadWhatsAppOutgoingMedia(savedPath, mimeType);

  if (!mediaId) {
    return NextResponse.json(
      { error: "Failed to upload the report to WhatsApp" },
      { status: 502 }
    );
  }

  // Plain document message — works as long as `recipient` has
  // messaged the bot within the last 24 hours. If you need this to
  // land reliably with no prior message from them, switch this to
  // sendWhatsAppDocumentTemplate() with an approved template instead.
  const sendResult = await sendWhatsAppDocumentMessage(
    recipient,
    mediaId,
    filename,
    "Here's the latest receipts report."
  );

  if (!sendResult.ok) {
    return NextResponse.json(
      {
        error: "Report uploaded but WhatsApp send failed",
        details: sendResult.body,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    sentTo: recipient,
    filename,
    savedPath,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { sendWhatsAppDocument } from "@/lib/whatsapp";

/*
 * POST /api/send-report
 *
 * Called by the external report-generation job (e.g. a Claude Cowork
 * schedule) right after it produces the weekly report. Takes the
 * report file as multipart/form-data and forwards it to whichever
 * WhatsApp number is configured in Settings as
 * `report_recipient_phone`.
 *
 * Auth: protected by a shared secret header, REPORT_WEBHOOK_SECRET,
 * so this endpoint can't be hit by randoms if it's ever exposed
 * publicly (e.g. deployed to Vercel).
 *
 * Example call (what Cowork/curl would run):
 *
 *   curl -X POST https://<your-domain>/api/send-report \
 *     -H "Authorization: Bearer $REPORT_WEBHOOK_SECRET" \
 *     -F "file=@weekly-report.pdf" \
 *     -F "caption=Weekly invoice report — 1 to 7 Sep"
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REPORT_WEBHOOK_SECRET;

  if (secret) {
    const authHeader = req.headers.get("authorization");

    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  const supabase = getSupabaseServerClient();

  const { data: settingRow, error: settingError } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "report_recipient_phone")
    .maybeSingle();

  if (settingError) {
    return NextResponse.json(
      { error: settingError.message },
      { status: 500 }
    );
  }

  const recipient = settingRow?.value;

  if (!recipient) {
    return NextResponse.json(
      {
        error:
          "No report recipient configured. Set one in the dashboard's Settings modal first.",
      },
      { status: 400 }
    );
  }

  let form: FormData;

  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  const caption = form.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'file' field in the upload" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const filename = file.name || "report";

  const result = await sendWhatsAppDocument(
    recipient,
    buffer,
    mimeType,
    filename,
    typeof caption === "string" ? caption : undefined
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: "WhatsApp send failed", detail: result.body },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent: true, to: recipient, detail: result.body });
}

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "media_storage_path")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    media_storage_path: data?.value ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const path = body?.media_storage_path;

  if (typeof path !== "string" || path.trim().length === 0) {
    return NextResponse.json(
      { error: "media_storage_path must be a non-empty string" },
      { status: 400 }
    );
  }

  const trimmedPath = path.trim();

  // Confirm the folder can actually be created/written to on this
  // machine before saving it — catching a bad path here beats
  // discovering it later when a real WhatsApp message comes in and
  // silently fails to save.
  try {
    await fs.mkdir(trimmedPath, { recursive: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: `That path isn't accessible: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("app_settings")
    .upsert(
      { key: "media_storage_path", value: trimmedPath, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    )
    .select("value")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    media_storage_path: data?.value ?? null,
  });
}
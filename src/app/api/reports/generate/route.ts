import { NextResponse } from "next/server";
import { runMonthlyReportJob } from "@/lib/scheduler";

// Test the report job on demand instead of waiting for the schedule:
//   curl -X POST http://localhost:3000/api/reports/generate
export async function POST() {
  try {
    const result = await runMonthlyReportJob();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    console.error("Manual report trigger failed:", err);
    return NextResponse.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

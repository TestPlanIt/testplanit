import { NextRequest } from "next/server";
import {
  handleFlakyTestsOptionsGET,
  handleFlakyTestsPOST,
} from "~/utils/flakyTestsUtils";

export async function GET(req: NextRequest) {
  return handleFlakyTestsOptionsGET(req, true);
}

export async function POST(req: NextRequest) {
  return handleFlakyTestsPOST(req, true);
}

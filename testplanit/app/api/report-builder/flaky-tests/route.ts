import { NextRequest } from "next/server";
import {
  handleFlakyTestsOptionsGET,
  handleFlakyTestsPOST,
} from "~/utils/flakyTestsUtils";

export async function GET(req: NextRequest) {
  return handleFlakyTestsOptionsGET(req, false);
}

export async function POST(req: NextRequest) {
  return handleFlakyTestsPOST(req, false);
}

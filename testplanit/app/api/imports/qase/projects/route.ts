import { NextRequest, NextResponse } from "next/server";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { listQaseProjects } from "~/services/imports/qase/jobPresenter";
import { QaseClient } from "~/services/imports/qase/qaseClient";
import {
  qaseErrorResponse,
  readConnection,
  requireAdminSession,
  unauthorized,
} from "../shared";

/** Lists the Qase projects a token can read, for the Connect step. */
async function handlePOST(request: NextRequest) {
  if (!(await requireAdminSession())) {
    return unauthorized();
  }

  const connection = readConnection(await request.json().catch(() => null));
  if (!connection) {
    return NextResponse.json(
      { error: "A Qase API token is required" },
      { status: 400 }
    );
  }

  try {
    const client = new QaseClient(connection);
    const projects = await listQaseProjects(client);
    return NextResponse.json({ host: client.host, projects });
  } catch (error) {
    const response = qaseErrorResponse(error);
    if (response) {
      return response;
    }
    console.error("Failed to list Qase projects", error);
    return NextResponse.json(
      { error: "Failed to list Qase projects" },
      { status: 500 }
    );
  }
}

export const POST = withRequestRouting(handlePOST);

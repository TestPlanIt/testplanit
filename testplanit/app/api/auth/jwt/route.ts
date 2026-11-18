import jsonwebtoken from "jsonwebtoken";
import { NextResponse } from "next/server";
import { withRequestRouting } from "~/lib/db/requestRouting";

const JWT_SECRET = process.env?.TIPTAP_COLLAB_SECRET as string;

async function handlePOST() {
  try {
    const jwt = await jsonwebtoken.sign(
      {/* object to be encoded in the JWT */},
      JWT_SECRET
    );
    return NextResponse.json({ token: jwt });
  } catch (error) {
    console.error("JWT generation error:", error);
    return NextResponse.error();
  }
}

export const POST = withRequestRouting(handlePOST);

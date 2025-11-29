import { NextResponse } from "next/server";
import jsonwebtoken from "jsonwebtoken";

const JWT_SECRET = process.env?.TIPTAP_COLLAB_SECRET as string;

export async function POST() {
  try {
    const jwt = await jsonwebtoken.sign(
      {
        /* object to be encoded in the JWT */
      },
      JWT_SECRET
    );
    return NextResponse.json({ token: jwt });
  } catch (error) {
    console.error("JWT generation error:", error);
    return NextResponse.error();
  }
}

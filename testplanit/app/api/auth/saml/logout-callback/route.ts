import { NextRequest, NextResponse } from "next/server";
import { createSAMLClient } from "~/server/saml-provider";
import { db } from "~/server/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const samlResponse = searchParams.get('SAMLResponse');
    const relayState = searchParams.get('RelayState');

    if (samlResponse) {
      // Decode and validate the SAML logout response
      const decodedResponse = Buffer.from(samlResponse, 'base64').toString('utf-8');
      // SAML logout response received

      // In a production environment, you would:
      // 1. Validate the SAML response signature
      // 2. Check the response status
      // 3. Verify the issuer
      // 4. Log the successful logout

      // For now, we'll assume the logout was successful
    }

    // Clear any remaining SAML cookies
    const response = NextResponse.redirect(new URL('/signin?logout=success', request.url));
    
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0, // Expire immediately
    };

    response.cookies.set('saml-state', '', cookieOptions);
    response.cookies.set('saml-provider', '', cookieOptions);
    response.cookies.set('saml-callback-url', '', cookieOptions);

    return response;
  } catch (error) {
    console.error('SAML logout callback error:', error);
    return NextResponse.redirect(new URL('/signin?error=logout-callback-failed', request.url));
  }
}

export async function POST(request: NextRequest) {
  // Handle SAML logout requests initiated by the IdP (Single Logout)
  try {
    const body = await request.text();
    const samlRequest = new URLSearchParams(body).get('SAMLRequest');

    if (samlRequest) {
      // Decode and process the SAML logout request
      const decodedRequest = Buffer.from(samlRequest, 'base64').toString('utf-8');
      // SAML logout request received from IdP

      // In a production environment, you would:
      // 1. Parse the SAML logout request
      // 2. Identify the user session to terminate
      // 3. Terminate the local session
      // 4. Generate a SAML logout response

      // For now, we'll return a basic logout response
      const logoutResponse = `
        <samlp:LogoutResponse 
          xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
          xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
          ID="_${Date.now()}"
          Version="2.0"
          IssueInstant="${new Date().toISOString()}"
          Destination=""
          InResponseTo="">
          <saml:Issuer>testplanit</saml:Issuer>
          <samlp:Status>
            <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
          </samlp:Status>
        </samlp:LogoutResponse>
      `;

      const encodedResponse = Buffer.from(logoutResponse).toString('base64');
      
      return new Response(`
        <html>
          <body onload="document.forms[0].submit()">
            <form method="post" action="">
              <input type="hidden" name="SAMLResponse" value="${encodedResponse}" />
            </form>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return NextResponse.json({ error: 'Invalid SAML logout request' }, { status: 400 });
  } catch (error) {
    console.error('SAML logout request processing error:', error);
    return NextResponse.json({ error: 'Failed to process logout request' }, { status: 500 });
  }
}
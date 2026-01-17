"use client";

import { useState, useEffect } from "react";
import { PasswordDialog } from "./PasswordDialog";

interface PasswordGateProps {
  shareKey: string;
  onVerified: () => void;
  projectName: string;
}

export function PasswordGate({ shareKey, onVerified, projectName }: PasswordGateProps) {
  const [hasValidToken, setHasValidToken] = useState(false);

  useEffect(() => {
    // Check if we have a valid token in sessionStorage
    const tokenKey = `share_token_${shareKey}`;
    const stored = sessionStorage.getItem(tokenKey);

    if (stored) {
      try {
        const { token, expiresAt } = JSON.parse(stored);
        if (new Date(expiresAt) > new Date()) {
          // Token is still valid
          setHasValidToken(true);
          onVerified();
          return;
        } else {
          // Token expired, remove it
          sessionStorage.removeItem(tokenKey);
        }
      } catch (error) {
        sessionStorage.removeItem(tokenKey);
      }
    }
  }, [shareKey]);

  const handlePasswordSuccess = (token: string, expiresIn: number) => {
    // Store token in sessionStorage
    const tokenKey = `share_token_${shareKey}`;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    sessionStorage.setItem(
      tokenKey,
      JSON.stringify({ token, expiresAt })
    );

    setHasValidToken(true);
    onVerified();
  };

  if (hasValidToken) {
    return null;
  }

  return (
    <PasswordDialog
      shareKey={shareKey}
      projectName={projectName}
      onSuccess={handlePasswordSuccess}
    />
  );
}

// Firefox and Safari start a download after the click handler returns and
// drop it if the address has already been released.
export function releaseDownloadUrl(url: string): void {
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

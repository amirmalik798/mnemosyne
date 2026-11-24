/** Read the token from the URL fragment used by verification emails. */
export function readVerificationToken(hash: string): string {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) return "";
  const params = new URLSearchParams(fragment);
  return params.get("token") ?? fragment;
}

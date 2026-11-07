// Provera "Sign in with Google" (Google Identity Services šalje ID token).
// Uključuje se sa GOOGLE_CLIENT_ID; u testovima se provera zamenjuje.
import { OAuth2Client } from "google-auth-library";
import { httpError } from "../../utils/errors.js";

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export const googleClientId = () => process.env.GOOGLE_CLIENT_ID || null;

let client: OAuth2Client | null = null;

async function verifyWithGoogle(credential: string): Promise<GoogleIdentity> {
  const audience = googleClientId();
  if (!audience) throw httpError(404, "Prijava preko Google-a nije podešena.");
  client ??= new OAuth2Client(audience);
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience });
    const p = ticket.getPayload();
    if (!p?.sub) throw new Error("payload");
    return { sub: p.sub, email: p.email?.toLowerCase() ?? null, emailVerified: !!p.email_verified, name: p.name ?? null };
  } catch {
    throw httpError(401, "Google prijava nije uspela. Pokušajte ponovo.");
  }
}

let verifier: (credential: string) => Promise<GoogleIdentity> = verifyWithGoogle;

export const verifyGoogleCredential = (credential: unknown) => {
  if (typeof credential !== "string" || credential.length < 10) throw httpError(400, "Nedostaje Google potvrda.");
  return verifier(credential);
};

/** Samo za testove */
export function setGoogleVerifier(fn: ((credential: string) => Promise<GoogleIdentity>) | null) {
  verifier = fn ?? verifyWithGoogle;
}

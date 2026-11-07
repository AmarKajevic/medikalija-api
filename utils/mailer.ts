// Slanje mejlova (pozivnice, nova lozinka) sa naloga doma.
// Gmail: GMAIL_USER (npr. dommedikalija@gmail.com) + GMAIL_APP_PASSWORD (lozinka za aplikaciju).
// Alternativa: RESEND_API_KEY + MAIL_FROM (sopstveni domen).
// Bez toga mejl se ne šalje — admin tada kopira link iz aplikacije i prosleđuje ga.
import nodemailer from "nodemailer";

const gmailUser = () => process.env.GMAIL_USER?.trim();
// Google prikazuje lozinku za aplikaciju u grupama od po 4 slova sa razmacima
const gmailPassword = () => process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
const useGmail = () => !!gmailUser() && !!gmailPassword();
const useResend = () => !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;

export const isMailEnabled = () => useGmail() || useResend();

/** Pošiljalac: "Dom Medikalija <dommedikalija@gmail.com>" */
function sender(): string {
  if (!useGmail()) return process.env.MAIL_FROM!;
  const name = process.env.MAIL_FROM_NAME?.trim() || "Dom Medikalija";
  return `"${name.replace(/"/g, "")}" <${gmailUser()}>`;
}

let gmailTransport: nodemailer.Transporter | null = null;
const gmail = () =>
  (gmailTransport ??= nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser(), pass: gmailPassword() } }));

/** Za testove: zamena Gmail veze (null = prava veza) */
export function setMailTransport(transport: nodemailer.Transporter | null) {
  gmailTransport = transport;
}

export async function sendMail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  if (!isMailEnabled()) return false;
  try {
    if (useGmail()) {
      await gmail().sendMail({ from: sender(), to, subject, html, text });
      return true;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender(), to, subject, html, text }),
    });
    if (!res.ok) console.error("Mejl nije poslat:", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("Mejl nije poslat:", err);
    return false;
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Jednostavan mejl sa jednim dugmetom (radi i u starim mejl klijentima) */
export function linkEmail({ facility, greeting, body, action, url, footer }: { facility: string; greeting: string; body: string; action: string; url: string; footer: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:14px;color:#71717a">${escape(facility)}</td></tr>
<tr><td style="padding-top:16px;font-size:16px">${escape(greeting)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.5">${escape(body)}</td></tr>
<tr><td style="padding-top:24px"><a href="${escape(url)}" style="display:inline-block;background:#2c712e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escape(action)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#71717a;line-height:1.5">${escape(footer)}<br>${escape(url)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${greeting}\n\n${body}\n\n${action}: ${url}\n\n${footer}`;
  return { html, text };
}

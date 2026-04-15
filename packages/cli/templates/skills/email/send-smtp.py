#!/usr/bin/env python3
# Minimal SMTP sender used by the email skill's non-Gmail branch.
# Reads SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS from env (injected
# from the agent's secrets vault). STARTTLS on 587, implicit TLS on 465,
# plaintext refused.
import argparse
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage


def die(msg: str, code: int = 1) -> None:
    sys.stderr.write(f"send-smtp: {msg}\n")
    sys.exit(code)


def split_recipients(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [r.strip() for r in raw.split(",") if r.strip()]


def main() -> int:
    ap = argparse.ArgumentParser(description="Send email via SMTP (uses vault env vars)")
    ap.add_argument("--to", required=True, help="Comma-separated recipient list")
    ap.add_argument("--cc", help="Comma-separated CC list")
    ap.add_argument("--bcc", help="Comma-separated BCC list")
    ap.add_argument("--from", dest="sender", help="Override From: (defaults to SMTP_USER)")
    ap.add_argument("--reply-to", help="Reply-To header")
    ap.add_argument("--subject", required=True)
    body = ap.add_mutually_exclusive_group(required=True)
    body.add_argument("--body", help="Plain-text body")
    body.add_argument("--html", help="HTML body")
    args = ap.parse_args()

    host = os.environ.get("SMTP_HOST")
    port = os.environ.get("SMTP_PORT", "587")
    user = os.environ.get("SMTP_USER")
    passwd = os.environ.get("SMTP_PASS")

    missing = [k for k, v in {"SMTP_HOST": host, "SMTP_USER": user, "SMTP_PASS": passwd}.items() if not v]
    if missing:
        die(
            f"missing env var(s): {', '.join(missing)}. "
            "Ask the user to add them to the GranClaw secrets vault."
        )
    try:
        port_i = int(port)
    except ValueError:
        die(f"SMTP_PORT must be an integer, got {port!r}")

    to_list = split_recipients(args.to)
    cc_list = split_recipients(args.cc)
    bcc_list = split_recipients(args.bcc)
    if not to_list:
        die("--to must contain at least one recipient")

    msg = EmailMessage()
    msg["From"] = args.sender or user
    msg["To"] = ", ".join(to_list)
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    if args.reply_to:
        msg["Reply-To"] = args.reply_to
    msg["Subject"] = args.subject
    if args.html is not None:
        msg.set_content("This message requires an HTML-capable mail reader.")
        msg.add_alternative(args.html, subtype="html")
    else:
        msg.set_content(args.body)

    all_rcpts = to_list + cc_list + bcc_list
    ctx = ssl.create_default_context()
    try:
        if port_i == 465:
            with smtplib.SMTP_SSL(host, port_i, context=ctx, timeout=30) as s:
                s.login(user, passwd)
                s.send_message(msg, to_addrs=all_rcpts)
        else:
            with smtplib.SMTP(host, port_i, timeout=30) as s:
                s.ehlo()
                s.starttls(context=ctx)
                s.ehlo()
                s.login(user, passwd)
                s.send_message(msg, to_addrs=all_rcpts)
    except smtplib.SMTPAuthenticationError as e:
        die(
            f"authentication failed ({e.smtp_code} {e.smtp_error!r}). "
            "The user most likely pasted the account password instead of an app password, "
            "or their provider requires 2FA before SMTP is allowed. Ask them to regenerate an app password."
        )
    except smtplib.SMTPException as e:
        die(f"SMTP error: {e}")
    except OSError as e:
        die(f"network error connecting to {host}:{port_i}: {e}")

    print(f"sent to {len(all_rcpts)} recipient(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

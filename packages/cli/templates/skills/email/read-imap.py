#!/usr/bin/env python3
# Minimal IMAP reader used by the email skill's non-Gmail branch.
# Reads IMAP_HOST / IMAP_PORT / IMAP_USER / IMAP_PASS from env (injected
# from the agent's secrets vault). Implicit TLS only (port 993).
#
# Subcommands:
#   mailboxes                       list folders
#   list    --mailbox M --max N     latest N in M (newest first)
#   search  --mailbox M --query Q   IMAP search, returns matching UIDs + headers
#   fetch   --mailbox M --uid U     full message (headers + plain-text body preview)
import argparse
import email
import email.policy
import imaplib
import json
import os
import sys
from email.header import decode_header, make_header
from typing import Any


def die(msg: str, code: int = 1) -> None:
    sys.stderr.write(f"read-imap: {msg}\n")
    sys.exit(code)


def connect() -> imaplib.IMAP4_SSL:
    host = os.environ.get("IMAP_HOST")
    port = os.environ.get("IMAP_PORT", "993")
    user = os.environ.get("IMAP_USER")
    passwd = os.environ.get("IMAP_PASS")
    missing = [k for k, v in {"IMAP_HOST": host, "IMAP_USER": user, "IMAP_PASS": passwd}.items() if not v]
    if missing:
        die(
            f"missing env var(s): {', '.join(missing)}. "
            "Ask the user to add them to the GranClaw secrets vault."
        )
    try:
        port_i = int(port)
    except ValueError:
        die(f"IMAP_PORT must be an integer, got {port!r}")
    try:
        m = imaplib.IMAP4_SSL(host, port_i, timeout=30)
        m.login(user, passwd)
    except imaplib.IMAP4.error as e:
        die(f"authentication failed: {e}. If the error says AUTHENTICATIONFAILED, the user pasted the wrong password or is missing an app password.")
    except OSError as e:
        die(f"network error connecting to {host}:{port_i}: {e}")
    return m


def decode_hdr(raw: str | None) -> str:
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def parse_envelope(raw_bytes: bytes) -> dict[str, Any]:
    msg = email.message_from_bytes(raw_bytes, policy=email.policy.default)
    return {
        "from": decode_hdr(msg.get("From")),
        "to": decode_hdr(msg.get("To")),
        "cc": decode_hdr(msg.get("Cc")),
        "date": msg.get("Date"),
        "subject": decode_hdr(msg.get("Subject")),
        "message_id": msg.get("Message-ID"),
    }


def extract_plain(raw_bytes: bytes, max_chars: int = 4000) -> str:
    msg = email.message_from_bytes(raw_bytes, policy=email.policy.default)
    body = msg.get_body(preferencelist=("plain", "html"))
    if body is None:
        return ""
    text = body.get_content()
    if max_chars and len(text) > max_chars:
        text = text[:max_chars] + f"\n\n[... truncated, {len(text) - max_chars} more chars]"
    return text


def select_mailbox(m: imaplib.IMAP4_SSL, mailbox: str) -> int:
    typ, data = m.select(mailbox, readonly=True)
    if typ != "OK":
        die(f"cannot select mailbox {mailbox!r}: {data}")
    try:
        return int(data[0])
    except (ValueError, IndexError):
        return 0


def cmd_mailboxes(args: argparse.Namespace) -> int:
    m = connect()
    try:
        typ, data = m.list()
        if typ != "OK":
            die(f"LIST failed: {data}")
        out = []
        for raw in data:
            out.append(raw.decode("utf-8", errors="replace"))
        print("\n".join(out))
    finally:
        m.logout()
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    m = connect()
    try:
        total = select_mailbox(m, args.mailbox)
        if total == 0:
            print("[]")
            return 0
        start = max(1, total - args.max + 1)
        typ, data = m.fetch(f"{start}:{total}", "(UID BODY.PEEK[HEADER.FIELDS (FROM TO CC DATE SUBJECT MESSAGE-ID)])")
        if typ != "OK":
            die(f"FETCH failed: {data}")
        results = []
        pending: dict[str, Any] = {}
        for item in data:
            if isinstance(item, tuple):
                header_bytes = item[1]
                envelope = parse_envelope(header_bytes)
                meta = item[0].decode("utf-8", errors="replace")
                uid = None
                if "UID " in meta:
                    uid_part = meta.split("UID ", 1)[1].split(" ", 1)[0].rstrip(")")
                    try:
                        uid = int(uid_part)
                    except ValueError:
                        uid = None
                envelope["uid"] = uid
                results.append(envelope)
        results.reverse()
        print(json.dumps(results, indent=2, ensure_ascii=False))
    finally:
        m.logout()
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    m = connect()
    try:
        select_mailbox(m, args.mailbox)
        typ, data = m.uid("SEARCH", None, args.query)
        if typ != "OK":
            die(f"SEARCH failed: {data}")
        uids = data[0].split() if data and data[0] else []
        if not uids:
            print("[]")
            return 0
        uids = uids[-args.max:]
        uid_set = b",".join(uids).decode("ascii")
        typ, fdata = m.uid("FETCH", uid_set, "(BODY.PEEK[HEADER.FIELDS (FROM TO CC DATE SUBJECT MESSAGE-ID)])")
        if typ != "OK":
            die(f"FETCH after SEARCH failed: {fdata}")
        results = []
        for item in fdata:
            if isinstance(item, tuple):
                meta = item[0].decode("utf-8", errors="replace")
                envelope = parse_envelope(item[1])
                uid = None
                if "UID " in meta:
                    uid_part = meta.split("UID ", 1)[1].split(" ", 1)[0].rstrip(")")
                    try:
                        uid = int(uid_part)
                    except ValueError:
                        uid = None
                envelope["uid"] = uid
                results.append(envelope)
        results.reverse()
        print(json.dumps(results, indent=2, ensure_ascii=False))
    finally:
        m.logout()
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    m = connect()
    try:
        select_mailbox(m, args.mailbox)
        typ, data = m.uid("FETCH", str(args.uid), "(RFC822)")
        if typ != "OK":
            die(f"FETCH failed: {data}")
        if not data or data[0] is None:
            die(f"no message with UID {args.uid} in {args.mailbox}")
        raw = None
        for item in data:
            if isinstance(item, tuple):
                raw = item[1]
                break
        if raw is None:
            die("message body missing from FETCH response")
        envelope = parse_envelope(raw)
        body = extract_plain(raw, max_chars=args.max_chars)
        result = {**envelope, "body": body}
        print(json.dumps(result, indent=2, ensure_ascii=False))
    finally:
        m.logout()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="IMAP reader (uses vault env vars)")
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("mailboxes", help="List available mailboxes/folders")

    pl = sub.add_parser("list", help="List most recent N messages in a mailbox")
    pl.add_argument("--mailbox", default="INBOX")
    pl.add_argument("--max", type=int, default=20)

    ps = sub.add_parser("search", help="Run an IMAP search, return matching headers")
    ps.add_argument("--mailbox", default="INBOX")
    ps.add_argument("--query", required=True, help='IMAP search spec, e.g. UNSEEN FROM "alice@example.com"')
    ps.add_argument("--max", type=int, default=20)

    pf = sub.add_parser("fetch", help="Fetch a single message by UID")
    pf.add_argument("--mailbox", default="INBOX")
    pf.add_argument("--uid", type=int, required=True)
    pf.add_argument("--max-chars", type=int, default=4000)

    args = ap.parse_args()
    handlers = {"mailboxes": cmd_mailboxes, "list": cmd_list, "search": cmd_search, "fetch": cmd_fetch}
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

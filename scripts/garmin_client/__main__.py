"""CLI runner for the garmin_client package.

Called by the Node source adapter via subprocess.
NEVER uses fake client in runtime -- --token is required for data operations.

Commands:
  list-activities   --start N --limit N --token <dir>   -> JSON array
  get-activity      --activity-id <id> --token <dir>    -> JSON object
  login             --email E --token <dir>              -> Interactive (password via getpass)
  login-mfa         --token <dir> --code <N>             -> Complete MFA
  status            --token <dir>                        -> {"ok": bool}

All credential input (password, MFA code) is handled via getpass/input on
stdin, NEVER via argv to avoid leaking through ps.
"""
import argparse
import json
import sys
import os

from garmin_client.client import create_real_client


def main():
    parser = argparse.ArgumentParser(
        description="Garmin Connect client CLI (--token required for data ops)"
    )
    parser.add_argument(
        "command",
        choices=["list-activities", "get-activity", "login", "login-mfa", "status"],
    )
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--activity-id", type=str, default=None)
    parser.add_argument("--email", type=str, default=None)
    parser.add_argument("--token", type=str, default=None)
    parser.add_argument("--code", type=str, default=None)

    args = parser.parse_args()

    # -- commands that don't need token ----------------------------------------
    if args.command == "login":
        if not args.email:
            msg = json.dumps({"ok": False, "error": "--email is required for login"})
            print(msg, file=sys.stderr)
            sys.exit(1)
        token_dir = os.path.abspath(args.token) if args.token else _default_token_dir(args.email)
        client = create_real_client(token_dir, "login")
        try:
            client.login(args.email)
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
            sys.exit(1)
        print(json.dumps({"ok": True, "token_dir": token_dir}), file=sys.stdout)
        sys.exit(0)

    if args.command == "login-mfa":
        # MFA is handled interactively within login(). This command exists for
        # auth-garmin.mjs compatibility.
        print(
            json.dumps({"ok": True, "note": "MFA handled interactively in login step"}),
            file=sys.stdout,
        )
        sys.exit(0)

    # -- commands that require a token -----------------------------------------
    if not args.token:
        msg = json.dumps({
            "ok": False,
            "error": "--token is required. Authenticate first via:\n"
                     "  python3 -m garmin_client login --email you@example.com",
        })
        print(msg, file=sys.stderr)
        sys.exit(1)

    token_dir = os.path.abspath(args.token)
    source_id = os.path.basename(token_dir)

    client = create_real_client(token_dir, source_id)
    if not client.resume():
        msg = json.dumps({
            "ok": False,
            "error": "Token expired or invalid. Re-authenticate with login command.",
        })
        print(msg, file=sys.stderr)
        sys.exit(1)

    if args.command == "list-activities":
        activities = client.list_activities(start=args.start, limit=args.limit)
        print(json.dumps(activities), file=sys.stdout)

    elif args.command == "get-activity":
        if not args.activity_id:
            print(json.dumps({"error": "--activity-id is required"}), file=sys.stderr)
            sys.exit(1)
        try:
            detail = client.get_activity_json(args.activity_id)
            print(json.dumps(detail), file=sys.stdout)
        except ValueError as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)

    elif args.command == "status":
        print(json.dumps({"ok": True, "source_id": source_id}), file=sys.stdout)

    else:
        print(json.dumps({"error": f"Command '{args.command}' not implemented"}), file=sys.stderr)
        sys.exit(1)


def _default_token_dir(email):
    """Derive a default token directory from email (fallback when --token omitted)."""
    safe = email.split("@")[0] if "@" in email else email
    return os.path.join(os.path.expanduser("~"), ".config", "trenern", "keys", f"garmin-{safe}")


if __name__ == "__main__":
    main()
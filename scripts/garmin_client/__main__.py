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
        choices=["list-activities", "get-activity", "login", "status"],
    )
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--activity-id", type=str, default=None)
    parser.add_argument("--token", type=str, required=True)

    args = parser.parse_args()

    if args.command == "login":
        if not sys.stdin.isatty():
            parser.error("login requires an interactive terminal")
        email = input("Garmin email: ").strip()
        if not email:
            parser.error("Garmin email is required")
        token_dir = os.path.abspath(args.token)
        client = create_real_client(token_dir, "login")
        try:
            client.login(email)
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
            sys.exit(1)
        print(json.dumps({"ok": True, "token_dir": token_dir}), file=sys.stdout)
        return

    # All data operations require a saved token directory.

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


if __name__ == "__main__":
    main()
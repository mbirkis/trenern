"""CLI runner for the garmin_client package.

Called by the Node source adapter via subprocess.
Uses FakeGarminClient by default; RealGarminClient loaded when --token is given.

Commands:
  list-activities   --start N --limit N        → JSON array
  get-activity      --activity-id <id>         → JSON object
  login             --email E --token <path>   → Interactive (prompts for password/MFA)
  login-mfa         --token <path> --code <N>  → Complete MFA
  status            --token <path>             → {"ok": bool}
"""
import argparse
import json
import sys
import os

from garmin_client.client import create_fake_client, create_real_client


def main():
    parser = argparse.ArgumentParser(description="Garmin Connect client CLI")
    parser.add_argument("command", choices=["list-activities", "get-activity", "login", "login-mfa", "status"])
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--activity-id", type=str, default=None)
    parser.add_argument("--email", type=str, default=None)
    parser.add_argument("--token", type=str, default=None)
    parser.add_argument("--code", type=str, default=None)

    args = parser.parse_args()

    if args.token:
        # Real client (requires credentials, token file exists)
        token_dir = os.path.dirname(os.path.abspath(args.token))
        source_id = os.path.basename(args.token).replace(".token.json", "").replace("garmin-", "", 1)
        client = create_real_client(token_dir, source_id)
        if not client.resume(args.token):
            print(json.dumps({"ok": False, "error": "Token expired or invalid"}), file=sys.stdout)
            sys.exit(1)
    else:
        # Fake client for testing without credentials
        client = create_fake_client()

    if args.command == "list-activities":
        activities = client.list_activities(start=args.start, limit=args.limit)
        print(json.dumps(activities), file=sys.stdout)

    elif args.command == "get-activity":
        if not args.activity_id:
            print(json.dumps({"error": "activity-id is required"}), file=sys.stderr)
            sys.exit(1)
        try:
            detail = client.get_activity_json(args.activity_id)
            print(json.dumps(detail), file=sys.stdout)
        except ValueError as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)

    else:
        print(json.dumps({"error": f"Command '{args.command}' not yet implemented via CLI"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
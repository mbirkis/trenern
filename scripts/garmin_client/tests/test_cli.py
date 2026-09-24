"""Tests for garmin_client CLI runner (called by Node adapter via subprocess).
Now requires --token for data operations; never falls back to fake client.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

_PYTHON = [
    str(
        Path(__file__).resolve().parent.parent / ".venv" / "bin" / "python"
        if sys.platform != "win32"
        else "python"
    )
]


class TestCliRunner:
    """The CLI runner must support these subcommands via `python -m garmin_client`."""

    def test_list_activities_requires_token(self):
        """list-activities without --token must return non-zero exit."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "list-activities", "--start", "0", "--limit", "20"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0
        assert "token" in (result.stderr + result.stdout).lower()

    def test_get_activity_requires_token(self):
        """get-activity without --token must return non-zero exit."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "get-activity", "--activity-id", "12345678"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0
        assert "token" in (result.stderr + result.stdout).lower()

    def test_list_activities_with_token_validates(self):
        """list-activities with --token pointing to missing dir must fail."""
        with tempfile.TemporaryDirectory() as td:
            token_dir = Path(td) / "nonexistent-garmin"
            result = subprocess.run(
                [*_PYTHON, "-m", "garmin_client", "list-activities", "--token", str(token_dir)],
                capture_output=True, text=True, timeout=10,
            )
            assert result.returncode != 0
            assert "invalid" in (result.stderr + result.stdout).lower()

    def test_get_activity_with_token_validates(self):
        """get-activity with --token pointing to missing dir must fail."""
        with tempfile.TemporaryDirectory() as td:
            token_dir = Path(td) / "nonexistent-garmin"
            result = subprocess.run(
                [*_PYTHON, "-m", "garmin_client", "get-activity", "--activity-id", "12345678", "--token", str(token_dir)],
                capture_output=True, text=True, timeout=10,
            )
            assert result.returncode != 0

    def test_invalid_subcommand_returns_nonzero(self):
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "invalid-command"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0

    def test_login_requires_tty(self):
        """No credential prompt through pipes or unauthenticated HTTP."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "login", "--token", "/nonexistent"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0
        assert "interactive terminal" in (result.stderr + result.stdout).lower()

    def test_login_mfa_stub_is_removed(self):
        """MFA cannot falsely report success without completing a login."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "login-mfa"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0

    def test_status_without_token_errors(self):
        """status without --token must error."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "status"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0
        assert "token" in (result.stderr + result.stdout).lower()
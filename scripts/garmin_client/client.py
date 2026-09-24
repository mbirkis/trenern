"""Garmin Connect client wrapper for Trenern.

Provides:
- GarminClientInterface: protocol for Garmin API access (processable by tests)
- create_fake_client(): returns a fake client using fixture data (testing only)
- create_real_client(token_dir, source_id): returns a live client using garminconnect
"""
from .interface import GarminClientInterface
from .fake_client import FakeGarminClient
from .real_client import RealGarminClient


def create_fake_client():
    """Return a FakeGarminClient for testing (no network calls)."""
    return FakeGarminClient()


def create_real_client(token_dir, source_id):
    """Return a RealGarminClient that calls the Garmin Connect API.

    Args:
        token_dir: Path to garth-format token directory (config/keys/garmin-{id}/)
        source_id: Source ID used as the token filename prefix

    The client starts unauthenticated; call client.resume() to load stored
    tokens, or client.login(email) for interactive auth.
    """
    return RealGarminClient(token_dir, source_id)
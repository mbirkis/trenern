"""Garmin Connect client wrapper for Trenern.

Provides:
- GarminClientInterface: protocol for Garmin API access
- create_fake_client(): returns a fake client using fixture data (testing)
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
        token_dir: Path to directory where tokens are stored (config/keys/)
        source_id: Source ID used as the token filename prefix
    """
    raise NotImplementedError("Real client requires Garmin credentials; use create_fake_client for tests")
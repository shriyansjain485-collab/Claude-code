"""Pytest plugin: every test runs with the network blocked.

The Jarvis network guard is installed for the whole test run. After each
test, if ANY code tried to reach a non-localhost address, the test fails,
even if the code swallowed the error. Tests that trigger the guard on purpose
are marked with @pytest.mark.expects_blocked.
"""

import pytest

from jarvis.safety import netguard

netguard.install()


@pytest.fixture(autouse=True)
def _no_outbound_connections(request):
    before = len(netguard.blocked_attempts)
    yield
    attempts = netguard.blocked_attempts[before:]
    if attempts and not request.node.get_closest_marker("expects_blocked"):
        pytest.fail(
            "This test tried to open an outbound network connection: " + "; ".join(attempts),
            pytrace=False,
        )

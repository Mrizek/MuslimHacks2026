import os
from pathlib import Path
import sys
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "courtside_backend.settings")

import django

django.setup()

from channels.testing import WebsocketCommunicator
from asgiref.sync import async_to_sync
from django.test import Client, SimpleTestCase

from courtside_backend.asgi import application
from matches.auth import Principal
from matches.errors import AuthorizationError, ValidationError
from matches.repositories import InMemoryMatchRepository
from matches.runtime import set_match_service
from matches.serialization import config_from_firestore, state_from_firestore, state_to_firestore
from matches.services import MatchService
from scoring_engine import MatchStatus, ScoringEngine


ORGANIZER = Principal("organizer-user", frozenset({"organizer"}), frozenset())
READ_ONLY = Principal("display-user", frozenset({"read_only"}), frozenset())


def singles_payload(court_id, **config):
    return {
        "court_id": court_id,
        "teams": [
            {"name": "North", "players": ["Nadia"]},
            {"name": "South", "players": ["Sami"]},
        ],
        "match_type": "singles",
        "config": config,
    }


def doubles_payload(court_id):
    return {
        "court_id": court_id,
        "teams": [
            {"name": "North", "players": ["Nadia", "Noor"]},
            {"name": "South", "players": ["Sami", "Sara"]},
        ],
        "match_type": "doubles",
        "config": {
            "serving_orders": {"team_0": [1, 0], "team_1": [0, 1]},
            "receiving_orders": {"team_0": [0, 1], "team_1": [1, 0]},
            "starting_server_team": 0,
            "starting_server_player": 1,
        },
    }


class SerializationTests(SimpleTestCase):
    def test_doubles_mid_tiebreak_round_trip(self):
        payload = doubles_payload("court-1")
        config = config_from_firestore(payload["teams"], payload["match_type"], payload["config"])
        engine = ScoringEngine(config)
        engine.override(
            games=[6, 6],
            in_tiebreak=True,
            tiebreak_initial_server_team=0,
            tiebreak_initial_server_player=1,
            points=[4, 3],
            point_number=7,
            server_team=1,
            server_player=1,
        )

        stored = state_to_firestore(engine.state)
        restored = state_from_firestore(stored, config)

        self.assertEqual(restored, engine.state)
        self.assertEqual(stored["completed_sets"], [])
        self.assertEqual(restored.tiebreak_initial_server_player, 1)


class RestApiTests(SimpleTestCase):
    def setUp(self):
        self.repository = InMemoryMatchRepository()
        self.service = MatchService(self.repository)
        set_match_service(self.service)
        self.client = Client()

    def tearDown(self):
        set_match_service(None)

    def test_swagger_ui_and_openapi_schema(self):
        docs_response = self.client.get("/api/docs/")
        schema_response = self.client.get("/api/schema/")

        self.assertEqual(docs_response.status_code, 200)
        self.assertContains(docs_response, "SwaggerUIBundle")
        self.assertEqual(schema_response.status_code, 200)
        schema = schema_response.json()
        self.assertIn("get", schema["paths"]["/courts/"])
        self.assertIn("post", schema["paths"]["/courts/"])
        self.assertIn("get", schema["paths"]["/matches/"])
        self.assertIn("post", schema["paths"]["/matches/"])
        create_match_example = schema["paths"]["/matches/"]["post"]["requestBody"]["content"][
            "application/json"
        ]["example"]
        self.assertIn("games_per_set", create_match_example["config"])
        self.assertIn("serving_orders", create_match_example["config"])

    def test_match_creation_and_retrieval(self):
        court_response = self.client.post(
            "/api/courts/", {"name": "Court One"}, content_type="application/json"
        )
        self.assertEqual(court_response.status_code, 201)
        court_id = court_response.json()["id"]

        create_response = self.client.post(
            "/api/matches/", singles_payload(court_id), content_type="application/json"
        )
        self.assertEqual(create_response.status_code, 201)
        created = create_response.json()
        self.assertNotIn("version", created)
        self.assertEqual(created["state"]["points"], [0, 0])
        self.assertEqual(created["display_score"]["points"], ["0", "0"])

        get_response = self.client.get(f"/api/matches/{created['match_id']}/")
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json(), created)


class ServiceSafetyTests(SimpleTestCase):
    def setUp(self):
        self.repository = InMemoryMatchRepository()
        self.service = MatchService(self.repository)
        self.court = self.service.create_court(ORGANIZER, {"name": "Court One"})
        self.created = self.service.create_match(ORGANIZER, singles_payload(self.court["id"]))
        self.match_id = self.created["match_id"]

    def test_invalid_and_unauthorized_overrides_leave_state_unchanged(self):
        scorer = Principal("scorer", frozenset({"scorer"}), frozenset({self.court["id"]}))
        before = self.repository.get_match(self.match_id)

        with self.assertRaises(AuthorizationError):
            self.service.mutate(scorer, self.match_id, "override", {"changes": {"games": [2, 1]}})
        with self.assertRaises(ValidationError):
            self.service.mutate(
                ORGANIZER,
                self.match_id,
                "override",
                {"changes": {"points": [3, 2]}},
            )

        self.assertEqual(self.repository.get_match(self.match_id), before)

    def test_completed_match_rejects_scoring(self):
        fast = self.service.create_match(
            ORGANIZER,
            singles_payload(self.court["id"], games_per_set=1, tiebreak_at=1),
        )
        # Even this shortened set still follows tennis's two-game-margin rule.
        for _ in range(8):
            result = self.service.mutate(
                ORGANIZER,
                fast["match_id"],
                "score_point",
                {"winner_team": 0},
            )
        self.assertEqual(result["state"]["status"], MatchStatus.COMPLETE.value)
        before_rejected_command = self.repository.get_match(fast["match_id"])

        with self.assertRaises(ValidationError):
            self.service.mutate(
                ORGANIZER,
                fast["match_id"],
                "score_point",
                {"winner_team": 0},
            )
        self.assertEqual(self.repository.get_match(fast["match_id"]), before_rejected_command)


class WebSocketTests(SimpleTestCase):
    def setUp(self):
        self.repository = InMemoryMatchRepository()
        self.service = MatchService(self.repository)
        set_match_service(self.service)
        self.court = self.service.create_court(ORGANIZER, {"name": "Court One"})
        self.match = self.service.create_match(ORGANIZER, singles_payload(self.court["id"]))
        self.communicators = []

    def tearDown(self):
        async_to_sync(self._disconnect_all)()
        set_match_service(None)

    async def _disconnect_all(self):
        for communicator in self.communicators:
            await communicator.disconnect()

    async def connect_match(self, match_id=None):
        match_id = match_id or self.match["match_id"]
        communicator = WebsocketCommunicator(application, f"/ws/matches/{match_id}/")
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        snapshot = await communicator.receive_json_from()
        self.assertEqual(snapshot["type"], "match_snapshot")
        self.communicators.append(communicator)
        return communicator, snapshot

    async def connect_dashboard(self):
        communicator = WebsocketCommunicator(application, "/ws/dashboard/")
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        snapshot = await communicator.receive_json_from()
        self.assertEqual(snapshot["type"], "match_snapshot")
        self.communicators.append(communicator)
        return communicator

    async def send_point(self, communicator):
        action_id = str(uuid4())
        await communicator.send_json_to(
            {
                "type": "score_point",
                "action_id": action_id,
                "payload": {"winner_team": 0},
            }
        )
        return action_id

    async def test_two_clients_receive_the_same_accepted_update(self):
        first, _ = await self.connect_match()
        second, _ = await self.connect_match()

        action_id = await self.send_point(first)
        acknowledgement = await first.receive_json_from()
        first_update = await first.receive_json_from()
        second_update = await second.receive_json_from()

        self.assertEqual(acknowledgement["type"], "action_ack")
        self.assertEqual(acknowledgement["action_id"], action_id)
        self.assertEqual(first_update, second_update)
        self.assertNotIn("version", first_update)
        self.assertEqual(first_update["state"]["points"], [1, 0])

    async def test_anonymous_client_can_use_other_match_commands(self):
        communicator, _ = await self.connect_match()

        umpire_id = str(uuid4())
        await communicator.send_json_to(
            {"type": "request_umpire", "action_id": umpire_id, "payload": {}}
        )
        self.assertEqual((await communicator.receive_json_from())["action_id"], umpire_id)
        self.assertTrue((await communicator.receive_json_from())["state"]["umpire_requested"])

        override_id = str(uuid4())
        await communicator.send_json_to(
            {
                "type": "override",
                "action_id": override_id,
                "payload": {"changes": {"games": [2, 1]}},
            }
        )
        self.assertEqual((await communicator.receive_json_from())["action_id"], override_id)
        self.assertEqual((await communicator.receive_json_from())["state"]["games"], [2, 1])

        state_id = str(uuid4())
        await communicator.send_json_to({"type": "get_state", "action_id": state_id})
        state = await communicator.receive_json_from()
        self.assertEqual(state["action_id"], state_id)
        self.assertEqual(state["state"]["games"], [2, 1])

    async def test_dashboard_updates_and_match_groups_are_isolated(self):
        second_match = self.service.create_match(ORGANIZER, singles_payload(self.court["id"]))
        active, _ = await self.connect_match()
        isolated, _ = await self.connect_match(second_match["match_id"])
        dashboard = await self.connect_dashboard()

        await self.send_point(active)
        await active.receive_json_from()  # acknowledgement
        await active.receive_json_from()  # its group update
        dashboard_update = await dashboard.receive_json_from()

        self.assertEqual(dashboard_update["type"], "match_updated")
        self.assertEqual(dashboard_update["match_id"], self.match["match_id"])
        self.assertTrue(await isolated.receive_nothing(timeout=0.1))

    async def test_two_commands_without_versions_are_both_applied(self):
        first, _ = await self.connect_match()
        second, _ = await self.connect_match()
        first_action = await self.send_point(first)
        first_ack = await first.receive_json_from()
        await first.receive_json_from()
        await second.receive_json_from()

        second_action = await self.send_point(second)
        second_ack = await second.receive_json_from()
        await second.receive_json_from()
        await first.receive_json_from()

        self.assertEqual(first_ack["action_id"], first_action)
        self.assertEqual(second_ack["action_id"], second_action)
        saved = self.service.get_match(ORGANIZER, self.match["match_id"])
        self.assertNotIn("version", saved)
        self.assertEqual(saved["state"]["points"], [2, 0])

    async def test_persistence_failure_has_no_success_broadcast(self):
        active, _ = await self.connect_match()
        dashboard = await self.connect_dashboard()
        self.repository.fail_next_transaction = True

        action_id = await self.send_point(active)
        error = await active.receive_json_from()

        self.assertEqual(error["type"], "error")
        self.assertEqual(error["action_id"], action_id)
        self.assertEqual(error["code"], "persistence_error")
        self.assertTrue(await dashboard.receive_nothing(timeout=0.1))
        self.assertEqual(self.repository.get_match(self.match["match_id"])["state"]["points"], [0, 0])

    async def test_reconnection_restores_saved_state(self):
        first, _ = await self.connect_match()
        await self.send_point(first)
        await first.receive_json_from()
        await first.receive_json_from()
        await first.disconnect()
        self.communicators.remove(first)

        reconnected, snapshot = await self.connect_match()

        self.assertNotIn("version", snapshot)
        self.assertEqual(snapshot["state"]["points"], [1, 0])

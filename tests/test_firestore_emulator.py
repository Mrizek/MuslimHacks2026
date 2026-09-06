"""Optional integration check run only while the Firestore emulator is active."""

import os
from pathlib import Path
import sys
import unittest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "courtside_backend.settings")

import django

django.setup()

from django.test import SimpleTestCase

from matches.auth import Principal
from matches.repositories import FirestoreMatchRepository
from matches.services import MatchService


ORGANIZER = Principal("emulator-organizer", frozenset({"organizer"}), frozenset())


@unittest.skipUnless(os.environ.get("FIRESTORE_EMULATOR_HOST"), "Firestore emulator is not configured")
class FirestoreEmulatorTests(SimpleTestCase):
    def setUp(self):
        self.repository = FirestoreMatchRepository()
        self.service = MatchService(self.repository)
        self.created_ids = {"courts": [], "matches": []}

    def tearDown(self):
        for collection, document_ids in self.created_ids.items():
            for document_id in document_ids:
                self.repository.client.collection(collection).document(document_id).delete()

    def test_create_restore_and_transaction_update(self):
        court = self.service.create_court(ORGANIZER, {"name": "Emulator Court"})
        self.created_ids["courts"].append(court["id"])
        match = self.service.create_match(
            ORGANIZER,
            {
                "court_id": court["id"],
                "teams": [
                    {"name": "North", "players": ["Nadia"]},
                    {"name": "South", "players": ["Sami"]},
                ],
                "match_type": "singles",
                "config": {},
            },
        )
        self.created_ids["matches"].append(match["match_id"])

        updated = self.service.mutate(
            ORGANIZER,
            match["match_id"],
            "score_point",
            {"winner_team": 0},
        )
        restored = self.service.get_match(ORGANIZER, match["match_id"])

        self.assertEqual(updated, restored)
        self.assertNotIn("version", restored)
        self.assertEqual(restored["state"]["points"], [1, 0])
        second = self.service.mutate(
            ORGANIZER,
            match["match_id"],
            "score_point",
            {"winner_team": 0},
        )
        self.assertEqual(second["state"]["points"], [2, 0])

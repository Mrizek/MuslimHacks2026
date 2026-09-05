from __future__ import annotations

from copy import deepcopy
from threading import RLock
from typing import Any, Callable
from uuid import uuid4

from firebase_admin import firestore
from google.api_core.exceptions import GoogleAPICallError

from .errors import NotFoundError, PersistenceError
from .firebase import get_firestore_client


Mutation = Callable[[dict[str, Any]], dict[str, Any]]


class InMemoryMatchRepository:
    """Atomic repository used by fast tests; it follows the Firestore contract."""

    def __init__(self) -> None:
        self.courts: dict[str, dict[str, Any]] = {}
        self.matches: dict[str, dict[str, Any]] = {}
        self._lock = RLock()
        self.fail_next_transaction = False

    def create_court(self, name: str) -> dict[str, Any]:
        court_id = uuid4().hex
        document = {"id": court_id, "name": name}
        with self._lock:
            self.courts[court_id] = deepcopy(document)
        return document

    def delete_court(self, court_id: str) -> None:
        with self._lock:
            if court_id not in self.courts:
                raise NotFoundError("Court not found.")
            del self.courts[court_id]
            for match_id, match in list(self.matches.items()):
                if match["court_id"] == court_id:
                    del self.matches[match_id]

    def court_exists(self, court_id: str) -> bool:
        with self._lock:
            return court_id in self.courts

    def list_courts(self) -> list[dict[str, Any]]:
        with self._lock:
            return deepcopy(list(self.courts.values()))

    def create_match(self, document: dict[str, Any]) -> dict[str, Any]:
        match_id = uuid4().hex
        stored = {**deepcopy(document), "id": match_id}
        with self._lock:
            self.matches[match_id] = stored
        return deepcopy(stored)

    def delete_match(self, match_id: str) -> None:
        with self._lock:
            if match_id not in self.matches:
                raise NotFoundError("Match not found.")
            del self.matches[match_id]

    def get_match(self, match_id: str) -> dict[str, Any]:
        with self._lock:
            if match_id not in self.matches:
                raise NotFoundError("Match not found.")
            return deepcopy(self.matches[match_id])

    def list_matches(self) -> list[dict[str, Any]]:
        with self._lock:
            return deepcopy(list(self.matches.values()))

    def transact_match(self, match_id: str, mutation: Mutation) -> dict[str, Any]:
        with self._lock:
            if match_id not in self.matches:
                raise NotFoundError("Match not found.")
            current = deepcopy(self.matches[match_id])
            updated = mutation(current)
            if self.fail_next_transaction:
                self.fail_next_transaction = False
                raise PersistenceError("The match could not be saved.")
            updated["id"] = match_id
            self.matches[match_id] = deepcopy(updated)
            return deepcopy(updated)


class FirestoreMatchRepository:
    def __init__(self, client=None) -> None:
        self.client = client or get_firestore_client()

    def create_court(self, name: str) -> dict[str, Any]:
        reference = self.client.collection("courts").document()
        reference.set({"name": name})
        return {"id": reference.id, "name": name}

    def delete_court(self, court_id: str) -> None:
        court_reference = self.client.collection("courts").document(court_id)
        if not court_reference.get().exists:
            raise NotFoundError("Court not found.")
        batch = self.client.batch()
        batch.delete(court_reference)
        for match in self.client.collection("matches").where("court_id", "==", court_id).stream():
            batch.delete(match.reference)
        batch.commit()

    def court_exists(self, court_id: str) -> bool:
        return self.client.collection("courts").document(court_id).get().exists

    def list_courts(self) -> list[dict[str, Any]]:
        return [{"id": item.id, **item.to_dict()} for item in self.client.collection("courts").stream()]

    def create_match(self, document: dict[str, Any]) -> dict[str, Any]:
        reference = self.client.collection("matches").document()
        reference.set(deepcopy(document))
        return {"id": reference.id, **deepcopy(document)}

    def delete_match(self, match_id: str) -> None:
        reference = self.client.collection("matches").document(match_id)
        if not reference.get().exists:
            raise NotFoundError("Match not found.")
        reference.delete()

    def get_match(self, match_id: str) -> dict[str, Any]:
        snapshot = self.client.collection("matches").document(match_id).get()
        if not snapshot.exists:
            raise NotFoundError("Match not found.")
        return {"id": snapshot.id, **snapshot.to_dict()}

    def list_matches(self) -> list[dict[str, Any]]:
        return [{"id": item.id, **item.to_dict()} for item in self.client.collection("matches").stream()]

    def transact_match(self, match_id: str, mutation: Mutation) -> dict[str, Any]:
        reference = self.client.collection("matches").document(match_id)
        transaction = self.client.transaction()

        @firestore.transactional
        def apply(transaction):
            snapshot = reference.get(transaction=transaction)
            if not snapshot.exists:
                raise NotFoundError("Match not found.")
            current = {"id": snapshot.id, **snapshot.to_dict()}
            # This callback may run more than once. It only computes a local
            # document and schedules its write; broadcasts happen after commit.
            updated = mutation(current)
            stored = {key: value for key, value in updated.items() if key != "id"}
            transaction.set(reference, stored)
            return {"id": match_id, **stored}

        try:
            return apply(transaction)
        except NotFoundError:
            raise
        except GoogleAPICallError as exc:
            raise PersistenceError("The match could not be saved.") from exc

from __future__ import annotations

import os
from threading import Lock

import firebase_admin
from django.conf import settings
from firebase_admin import credentials, firestore


_client = None
_lock = Lock()


def get_firestore_client():
    """Initialize Firebase once, using the emulator or application credentials."""
    global _client
    if _client is not None:
        return _client

    with _lock:
        if _client is not None:
            return _client
        try:
            app = firebase_admin.get_app()
        except ValueError:
            options = {"projectId": settings.FIREBASE_PROJECT_ID}
            if os.environ.get("FIRESTORE_EMULATOR_HOST"):
                app = firebase_admin.initialize_app(options=options)
            else:
                app = firebase_admin.initialize_app(credentials.ApplicationDefault(), options)
        _client = firestore.client(app=app)
        return _client

from __future__ import annotations

import re
from uuid import UUID

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .errors import BackendError, ValidationError
from .runtime import get_match_service


MATCH_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
MUTATING_COMMANDS = {
    "score_point",
    "request_umpire",
    "clear_umpire_request",
    "override",
}


def _valid_action_id(value) -> bool:
    if not isinstance(value, str):
        return False
    try:
        UUID(value)
        return True
    except ValueError:
        return False


class WebSocketConsumerBase(AsyncJsonWebsocketConsumer):
    async def send_error(self, error: BackendError, action_id=None) -> None:
        message = {
            "type": "error",
            "code": error.code,
            "message": error.message,
            **error.details,
        }
        if action_id is not None:
            message["action_id"] = action_id
        await self.send_json(message)


class MatchConsumer(WebSocketConsumerBase):
    async def connect(self) -> None:
        self.match_id = self.scope["url_route"]["kwargs"]["match_id"]
        if not MATCH_ID_PATTERN.fullmatch(self.match_id):
            await self.close(code=4400)
            return

        self.group_name = f"match.{self.match_id}"
        await self.accept()
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        try:
            snapshot = await sync_to_async(
                lambda: get_match_service().get_match(None, self.match_id),
                thread_sensitive=False,
            )()
            await self.send_json({"type": "match_snapshot", **snapshot})
        except BackendError as error:
            await self.send_error(error)
            await self.close(code=4404)

    async def disconnect(self, close_code) -> None:
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs) -> None:
        action_id = content.get("action_id") if isinstance(content, dict) else None
        try:
            if not isinstance(content, dict) or not _valid_action_id(action_id):
                raise ValidationError("action_id must be a UUID string.")
            command = content.get("type")
            if command == "get_state":
                if set(content) != {"type", "action_id"}:
                    raise ValidationError("get_state accepts only type and action_id.")
                snapshot = await sync_to_async(
                    lambda: get_match_service().get_match(None, self.match_id),
                    thread_sensitive=False,
                )()
                await self.send_json({"type": "match_snapshot", "action_id": action_id, **snapshot})
                return
            if command not in MUTATING_COMMANDS:
                raise ValidationError(f"Unsupported command: {command}.")
            if set(content) != {"type", "action_id", "payload"}:
                raise ValidationError("A command requires type, action_id, and payload.")

            snapshot = await sync_to_async(
                lambda: get_match_service().mutate(
                    None,
                    self.match_id,
                    command,
                    content["payload"],
                ),
                thread_sensitive=False,
            )()
            await self.send_json(
                {
                    "type": "action_ack",
                    "action_id": action_id,
                    "match_id": self.match_id,
                }
            )
            update = {"type": "match_updated", **snapshot}
            await self.channel_layer.group_send(
                self.group_name, {"type": "match.event", "message": update}
            )
            await self.channel_layer.group_send(
                "dashboard", {"type": "match.event", "message": update}
            )
        except BackendError as error:
            await self.send_error(error, action_id)

    async def match_event(self, event) -> None:
        await self.send_json(event["message"])


class DashboardConsumer(WebSocketConsumerBase):
    group_name = "dashboard"

    async def connect(self) -> None:
        await self.accept()
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        try:
            matches = await sync_to_async(
                lambda: get_match_service().list_matches(None), thread_sensitive=False
            )()
            await self.send_json({"type": "match_snapshot", "scope": "dashboard", "matches": matches})
        except BackendError as error:
            await self.send_error(error)
            await self.close(code=4500)

    async def disconnect(self, close_code) -> None:
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs) -> None:
        action_id = content.get("action_id") if isinstance(content, dict) else None
        try:
            if not isinstance(content, dict) or content.get("type") != "get_state" or not _valid_action_id(action_id):
                raise ValidationError("Dashboard supports get_state with a UUID action_id.")
            if set(content) != {"type", "action_id"}:
                raise ValidationError("get_state accepts only type and action_id.")
            matches = await sync_to_async(
                lambda: get_match_service().list_matches(None), thread_sensitive=False
            )()
            await self.send_json(
                {"type": "match_snapshot", "scope": "dashboard", "action_id": action_id, "matches": matches}
            )
        except BackendError as error:
            await self.send_error(error, action_id)

    async def match_event(self, event) -> None:
        await self.send_json(event["message"])

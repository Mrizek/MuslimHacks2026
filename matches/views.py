from __future__ import annotations

import json
from typing import Any

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .errors import BackendError, ValidationError
from .openapi import OPENAPI_SCHEMA, SWAGGER_UI_HTML
from .runtime import get_match_service


def _error_response(error: BackendError) -> JsonResponse:
    body = {"type": "error", "code": error.code, "message": error.message, **error.details}
    return JsonResponse(body, status=error.status)


def _json_body(request: HttpRequest) -> Any:
    try:
        return json.loads(request.body or b"{}")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError("The request body must be valid JSON.") from exc


def health(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return JsonResponse({"type": "error", "code": "method_not_allowed"}, status=405)
    return JsonResponse({"status": "ok"})


def api_schema(request: HttpRequest) -> JsonResponse:
    return JsonResponse(OPENAPI_SCHEMA)


def api_docs(request: HttpRequest) -> HttpResponse:
    return HttpResponse(SWAGGER_UI_HTML)


@csrf_exempt
def courts(request: HttpRequest) -> JsonResponse:
    try:
        service = get_match_service()
        if request.method == "GET":
            return JsonResponse({"courts": service.list_courts(None)})
        if request.method == "POST":
            return JsonResponse(service.create_court(None, _json_body(request)), status=201)
        return JsonResponse({"type": "error", "code": "method_not_allowed"}, status=405)
    except BackendError as error:
        return _error_response(error)


@csrf_exempt
def court_detail(request: HttpRequest, court_id: str) -> HttpResponse:
    if request.method != "DELETE":
        return JsonResponse({"type": "error", "code": "method_not_allowed"}, status=405)
    try:
        get_match_service().delete_court(None, court_id)
        return HttpResponse(status=204)
    except BackendError as error:
        return _error_response(error)


@csrf_exempt
def matches(request: HttpRequest) -> JsonResponse:
    try:
        service = get_match_service()
        if request.method == "GET":
            return JsonResponse({"matches": service.list_matches(None)})
        if request.method == "POST":
            return JsonResponse(service.create_match(None, _json_body(request)), status=201)
        return JsonResponse({"type": "error", "code": "method_not_allowed"}, status=405)
    except BackendError as error:
        return _error_response(error)


@csrf_exempt
def match_detail(request: HttpRequest, match_id: str) -> HttpResponse:
    try:
        if request.method == "GET":
            return JsonResponse(get_match_service().get_match(None, match_id))
        if request.method == "DELETE":
            get_match_service().delete_match(None, match_id)
            return HttpResponse(status=204)
        return JsonResponse({"type": "error", "code": "method_not_allowed"}, status=405)
    except BackendError as error:
        return _error_response(error)

from django.conf import settings
from urllib.parse import urlparse


class LocalCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("origin")
        if request.method == "OPTIONS":
            from django.http import HttpResponse

            response = HttpResponse()
        else:
            response = self.get_response(request)
        if origin and origin in settings.CORS_ALLOWED_ORIGINS:
            response["Access-Control-Allow-Origin"] = origin
            response["Vary"] = "Origin"
            response["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
            response["Access-Control-Allow-Headers"] = "Content-Type"
        return response


class LocalAllowedHostsOriginValidator:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        origin = None
        for key, value in scope.get("headers", []):
            if key == b"origin":
                origin = value.decode("latin1")
                break

        if origin is None or origin in settings.CORS_ALLOWED_ORIGINS:
            return await self.application(scope, receive, send)

        hostname = urlparse(origin).hostname
        if hostname in settings.ALLOWED_HOSTS or "*" in settings.ALLOWED_HOSTS:
            return await self.application(scope, receive, send)

        await send({"type": "websocket.close", "code": 403})

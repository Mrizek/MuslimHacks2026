import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "courtside_backend.settings")

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

from courtside_backend.cors import LocalAllowedHostsOriginValidator
from matches.routing import websocket_urlpatterns


application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": LocalAllowedHostsOriginValidator(URLRouter(websocket_urlpatterns)),
    }
)

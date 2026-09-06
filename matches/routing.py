from django.urls import path

from .consumers import DashboardConsumer, MatchConsumer


websocket_urlpatterns = [
    path("ws/matches/<str:match_id>/", MatchConsumer.as_asgi()),
    path("ws/dashboard/", DashboardConsumer.as_asgi()),
]

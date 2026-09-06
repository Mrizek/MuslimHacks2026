from django.urls import path

from . import views


urlpatterns = [
    path("docs/", views.api_docs),
    path("schema/", views.api_schema),
    path("health/", views.health),
    path("courts/", views.courts),
    path("courts/<str:court_id>/", views.court_detail),
    path("matches/", views.matches),
    path("matches/<str:match_id>/", views.match_detail),
]

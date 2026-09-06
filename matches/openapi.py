OPENAPI_SCHEMA = {
    "openapi": "3.0.3",
    "info": {
        "title": "CourtSide AI API",
        "version": "1.0.0",
        "description": "Local demo API for creating and reading tennis courts and matches.",
    },
    "servers": [{"url": "/api"}],
    "paths": {
        "/health/": {
            "get": {
                "summary": "Check backend health",
                "responses": {
                    "200": {
                        "description": "Backend is running",
                        "content": {
                            "application/json": {
                                "schema": {"type": "object", "properties": {"status": {"type": "string"}}},
                                "example": {"status": "ok"},
                            }
                        },
                    }
                },
            }
        },
        "/courts/": {
            "get": {
                "summary": "List courts",
                "responses": {
                    "200": {
                        "description": "Court list",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "courts": {
                                            "type": "array",
                                            "items": {"$ref": "#/components/schemas/Court"},
                                        }
                                    },
                                }
                            }
                        },
                    }
                },
            },
            "post": {
                "summary": "Create a court",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CreateCourt"},
                            "example": {"name": "Court 1"},
                        }
                    },
                },
                "responses": {
                    "201": {
                        "description": "Court created",
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/Court"}}
                        },
                    },
                    "400": {"$ref": "#/components/responses/Error"},
                },
            },
        },
        "/courts/{court_id}/": {
            "delete": {
                "summary": "Delete a court and its matches",
                "parameters": [
                    {
                        "name": "court_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "responses": {
                    "204": {"description": "Court deleted"},
                    "404": {"$ref": "#/components/responses/Error"},
                },
            }
        },
        "/matches/": {
            "get": {
                "summary": "List matches",
                "responses": {
                    "200": {
                        "description": "Match list",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "matches": {
                                            "type": "array",
                                            "items": {"$ref": "#/components/schemas/MatchSnapshot"},
                                        }
                                    },
                                }
                            }
                        },
                    }
                },
            },
            "post": {
                "summary": "Create a match",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CreateMatch"},
                            "example": {
                                "court_id": "PASTE_COURT_ID_HERE",
                                "teams": [
                                    {"name": "Team North", "players": ["Nadia"]},
                                    {"name": "Team South", "players": ["Sami"]},
                                ],
                                "match_type": "singles",
                                "config": {
                                    "no_ad": False,
                                    "games_per_set": 6,
                                    "tiebreak_at": 6,
                                    "tiebreak_points": 7,
                                    "sets_to_win": 1,
                                    "starting_server_team": 0,
                                    "starting_server_player": 0,
                                    "serving_orders": {"team_0": [0], "team_1": [0]},
                                    "receiving_orders": {"team_0": [0], "team_1": [0]},
                                },
                            },
                        }
                    },
                },
                "responses": {
                    "201": {
                        "description": "Match created",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/MatchSnapshot"}
                            }
                        },
                    },
                    "400": {"$ref": "#/components/responses/Error"},
                    "404": {"$ref": "#/components/responses/Error"},
                },
            },
        },
        "/matches/{match_id}/": {
            "get": {
                "summary": "Get a match",
                "parameters": [
                    {
                        "name": "match_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Match snapshot",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/MatchSnapshot"}
                            }
                        },
                    },
                    "404": {"$ref": "#/components/responses/Error"},
                },
            },
            "delete": {
                "summary": "Delete a match",
                "parameters": [
                    {
                        "name": "match_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "responses": {
                    "204": {"description": "Match deleted"},
                    "404": {"$ref": "#/components/responses/Error"},
                },
            },
        },
    },
    "components": {
        "schemas": {
            "Court": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "CreateCourt": {
                "type": "object",
                "required": ["name"],
                "additionalProperties": False,
                "properties": {"name": {"type": "string", "minLength": 1}},
            },
            "Team": {
                "type": "object",
                "required": ["name", "players"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "players": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 2},
                },
            },
            "PlayerOrders": {
                "type": "object",
                "required": ["team_0", "team_1"],
                "additionalProperties": False,
                "properties": {
                    "team_0": {"type": "array", "items": {"type": "integer"}},
                    "team_1": {"type": "array", "items": {"type": "integer"}},
                },
            },
            "MatchConfig": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "no_ad": {"type": "boolean", "default": False},
                    "games_per_set": {"type": "integer", "minimum": 1, "default": 6},
                    "tiebreak_at": {"type": "integer", "minimum": 1, "default": 6},
                    "tiebreak_points": {"type": "integer", "enum": [7, 10], "default": 7},
                    "sets_to_win": {"type": "integer", "minimum": 1, "default": 1},
                    "starting_server_team": {"type": "integer", "enum": [0, 1], "default": 0},
                    "starting_server_player": {"type": "integer", "minimum": 0, "default": 0},
                    "serving_orders": {"$ref": "#/components/schemas/PlayerOrders"},
                    "receiving_orders": {"$ref": "#/components/schemas/PlayerOrders"},
                },
            },
            "CreateMatch": {
                "type": "object",
                "required": ["court_id", "teams", "match_type", "config"],
                "additionalProperties": False,
                "properties": {
                    "court_id": {"type": "string"},
                    "teams": {
                        "type": "array",
                        "items": {"$ref": "#/components/schemas/Team"},
                        "minItems": 2,
                        "maxItems": 2,
                    },
                    "match_type": {"type": "string", "enum": ["singles", "doubles"]},
                    "config": {"$ref": "#/components/schemas/MatchConfig"},
                },
            },
            "MatchSnapshot": {
                "type": "object",
                "required": ["match_id", "court_id", "teams", "match_type", "config", "state", "display_score"],
                "properties": {
                    "match_id": {"type": "string"},
                    "court_id": {"type": "string"},
                    "teams": {"type": "array", "items": {"$ref": "#/components/schemas/Team"}},
                    "match_type": {"type": "string", "enum": ["singles", "doubles"]},
                    "config": {"$ref": "#/components/schemas/MatchConfig"},
                    "state": {"type": "object"},
                    "display_score": {"type": "object"},
                },
            },
            "Error": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "example": "error"},
                    "code": {"type": "string"},
                    "message": {"type": "string"},
                },
            },
        },
        "responses": {
            "Error": {
                "description": "Request error",
                "content": {
                    "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                },
            }
        },
    },
}


SWAGGER_UI_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CourtSide AI API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/schema/",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>
"""

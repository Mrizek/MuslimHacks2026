class BackendError(Exception):
    code = "backend_error"
    status = 400

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ValidationError(BackendError):
    code = "validation_error"


class AuthenticationError(BackendError):
    code = "authentication_error"
    status = 401


class AuthorizationError(BackendError):
    code = "permission_denied"
    status = 403


class NotFoundError(BackendError):
    code = "not_found"
    status = 404


class PersistenceError(BackendError):
    code = "persistence_error"
    status = 503

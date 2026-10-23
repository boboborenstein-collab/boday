from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from boday_agent.domain.models import Snapshot
from boday_agent.loop import AgentRequest, run_agent
from boday_agent.prompt import HistoryTurn
from boday_agent.server.auth import AuthError, TokenVerifier, cached_jwks, is_owner
from boday_agent.server.contract import (
    EncryptRequest,
    FeedbackRequest,
    RunRequest,
    RunSettings,
    error_body,
    run_settings_error,
)
from boday_agent.server.crypto import Encryptor, encryptor_from_b64
from boday_agent.server.providers import ProviderBuildError, build_provider, probe_connection
from boday_agent.server.ssrf import default_resolve
from boday_agent.server.traces import MemorySink, PostgresSink, feedback_event, postgres_connect

_log = logging.getLogger("boday_agent.server")
_UNSET = object()
_INVALID = "Check the message, snapshot, and model settings."
_UNAUTHORIZED = "Sign in required."
_NOT_CONFIGURED = "Key saving isn't available right now."
_TOO_LARGE = "That request is too large."
_INTERNAL = "Something went wrong. Try again."
_ADMIN_EMAIL = "bobo.borenstein@gmail.com"


class ServerConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    encryption_key_b64: str | None = None
    jwks_url: str | None = None
    jwt_secret: str | None = None
    admin_email: str = _ADMIN_EMAIL
    anthropic_api_key: str | None = None
    local_base_url: str | None = None
    local_model: str | None = None
    cf_access_client_id: str | None = None
    cf_access_client_secret: str | None = None
    traces_dsn: str | None = None
    jwt_issuer: str | None = None
    allowed_origins: list[str] = Field(default_factory=list)
    max_body_bytes: int = 4_194_304

    @classmethod
    def from_env(cls) -> ServerConfig:
        raw_origins = os.environ.get("AGENT_ALLOWED_ORIGINS", "")
        origins = [item.strip() for item in raw_origins.split(",") if item.strip()]
        return cls(
            encryption_key_b64=os.environ.get("AGENT_ENCRYPTION_KEY") or None,
            jwks_url=os.environ.get("SUPABASE_JWKS_URL") or None,
            jwt_secret=os.environ.get("SUPABASE_JWT_SECRET") or None,
            admin_email=os.environ.get("ADMIN_EMAIL") or _ADMIN_EMAIL,
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
            local_base_url=os.environ.get("BODAY_LOCAL_BASE_URL") or None,
            local_model=os.environ.get("BODAY_LOCAL_MODEL") or None,
            cf_access_client_id=os.environ.get("CF_ACCESS_CLIENT_ID") or None,
            cf_access_client_secret=os.environ.get("CF_ACCESS_CLIENT_SECRET") or None,
            traces_dsn=os.environ.get("AGENT_TRACES_DSN") or None,
            jwt_issuer=os.environ.get("SUPABASE_JWT_ISSUER") or None,
            allowed_origins=origins,
        )


class _AgentTestBody(BaseModel):
    settings: RunSettings


def create_app(
    config: ServerConfig,
    *,
    sink=None,
    verifier: TokenVerifier | None = None,
    encryptor=_UNSET,
    resolve=None,
    now=None,
) -> FastAPI:
    if sink is None:
        sink = (
            PostgresSink(postgres_connect(config.traces_dsn))
            if config.traces_dsn
            else MemorySink()
        )
    if verifier is None:
        if not config.jwks_url and not config.jwt_secret:
            raise ValueError("JWT verification is not configured")
        verifier = TokenVerifier(
            hs256_secret=config.jwt_secret,
            jwks_get=cached_jwks(config.jwks_url) if config.jwks_url else None,
            issuer=config.jwt_issuer,
        )
    if encryptor is _UNSET:
        encryptor = (
            encryptor_from_b64(config.encryption_key_b64) if config.encryption_key_b64 else None
        )
    if resolve is None:
        resolve = default_resolve

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.sink = sink
    app.state.verifier = verifier
    app.state.encryptor = encryptor
    app.state.config = config
    app.state.resolve = resolve
    app.state.now = now or (lambda: datetime.now(UTC))

    @app.exception_handler(RequestValidationError)
    def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content=error_body("INVALID_REQUEST", _INVALID),
        )

    @app.get("/health")
    def health(request: Request):
        user = _authorize(request)
        if isinstance(user, JSONResponse):
            return user
        return {"ok": True}

    @app.post("/encrypt")
    def encrypt(request: Request, body: EncryptRequest):
        user = _authorize(request)
        if isinstance(user, JSONResponse):
            return user
        encryptor = request.app.state.encryptor
        if encryptor is None:
            return JSONResponse(
                status_code=503,
                content=error_body("NOT_CONFIGURED", _NOT_CONFIGURED),
            )
        # Look up encrypt on the class so tests can patch app.Encryptor.encrypt.
        token = Encryptor.encrypt(encryptor, body.plaintext, user_id=user.id)
        return {"ciphertext": token}

    @app.post("/agent/run")
    def agent_run(request: Request, body: RunRequest):
        user = _authorize(request)
        if isinstance(user, JSONResponse):
            return user
        config = request.app.state.config
        problem = run_settings_error(
            body.settings,
            is_owner=is_owner(user, config.admin_email),
        )
        if problem is not None:
            status, code, message = problem
            return JSONResponse(status_code=status, content=error_body(code, message))
        try:
            provider, reason = build_provider(
                body.settings,
                user_id=user.id,
                encryptor=request.app.state.encryptor,
                anthropic_api_key=config.anthropic_api_key,
                local_base_url=config.local_base_url,
                local_model=config.local_model,
                cf_access_client_id=config.cf_access_client_id,
                cf_access_client_secret=config.cf_access_client_secret,
                resolve=request.app.state.resolve,
            )
        except ProviderBuildError as exc:
            return JSONResponse(status_code=400, content=error_body(exc.code, exc.message))
        try:
            snapshot = Snapshot.from_app(body.snapshot)
        except ValidationError:
            return JSONResponse(
                status_code=400,
                content=error_body("INVALID_REQUEST", _INVALID),
            )
        history = [
            HistoryTurn(
                role=item.role,
                text=item.text,
                proposal=item.proposal,
                proposal_status=item.proposal_status,
            )
            for item in body.history
        ]
        result = run_agent(
            AgentRequest(message=body.message, history=history, snapshot=snapshot),
            provider,
            selection_reason=reason,
        )
        try:
            request.app.state.sink.write(result.trace, user.id)
        except Exception as exc:
            _log.error("trace write %s", type(exc).__name__)
            return JSONResponse(
                status_code=500,
                content=error_body("TRACE_WRITE_FAILED", "Could not record the trace."),
            )
        return {
            "traceId": result.trace.run_id,
            "outcome": result.outcome,
            "text": result.text,
            "changes": result.changes,
            "question": result.question,
            "options": result.options,
            "parseWarnings": list(result.trace.parse_warnings),
        }

    @app.post("/feedback")
    def feedback(request: Request, body: FeedbackRequest):
        user = _authorize(request)
        if isinstance(user, JSONResponse):
            return user
        event = feedback_event(body.event, body.task_ids, now=request.app.state.now())
        wrote = request.app.state.sink.append_feedback(body.run_id, user.id, event)
        if not wrote:
            return JSONResponse(
                status_code=404,
                content=error_body("NOT_FOUND", "Trace not found."),
            )
        return {"ok": True}

    @app.post("/agent/test")
    def agent_test(request: Request, body: _AgentTestBody):
        user = _authorize(request)
        if isinstance(user, JSONResponse):
            return user
        config = request.app.state.config
        problem = run_settings_error(
            body.settings,
            is_owner=is_owner(user, config.admin_email),
        )
        if problem is not None:
            status, code, message = problem
            return JSONResponse(status_code=status, content=error_body(code, message))
        try:
            result = probe_connection(
                body.settings,
                user_id=user.id,
                encryptor=request.app.state.encryptor,
                anthropic_api_key=config.anthropic_api_key,
                local_base_url=config.local_base_url,
                local_model=config.local_model,
                cf_access_client_id=config.cf_access_client_id,
                cf_access_client_secret=config.cf_access_client_secret,
                resolve=request.app.state.resolve,
            )
        except ProviderBuildError as exc:
            return JSONResponse(status_code=400, content=error_body(exc.code, exc.message))
        return result

    app.add_middleware(ErrorMiddleware)
    app.add_middleware(BodyLimitMiddleware, max_bytes=config.max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
    )
    return app


def app_from_env() -> FastAPI:
    _configure_logging()
    return create_app(ServerConfig.from_env())


def _configure_logging() -> None:
    # uvicorn configures only its own loggers. Without a handler here the root
    # logger's WARNING level drops the per-request INFO lines.
    if _log.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s %(message)s"))
    _log.addHandler(handler)
    _log.setLevel(logging.INFO)


def _authorize(request: Request):
    try:
        user = request.app.state.verifier.verify(request.headers.get("authorization"))
    except AuthError:
        return JSONResponse(
            status_code=401,
            content=error_body("UNAUTHORIZED", _UNAUTHORIZED),
        )
    request.state.user_id = user.id
    return user


class ErrorMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        status = 500
        started = False

        async def send_wrapper(message):
            nonlocal status, started
            if message["type"] == "http.response.start":
                started = True
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            if started:
                raise
            _log.error("unhandled %s", type(exc).__name__)
            await _send_json(send, 500, error_body("INTERNAL_ERROR", _INTERNAL))
            status = 500
        # request.state writes into scope["state"], a plain dict.
        state = scope.get("state")
        user_id = state.get("user_id") if isinstance(state, dict) else None
        _log.info(
            "%s %s %s %s",
            scope.get("method", "-"),
            scope.get("path", "-"),
            status,
            user_id or "-",
        )


class BodyLimitMiddleware:
    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = _content_length(scope)
        if length is not None and length > self.max_bytes:
            await _send_json(send, 413, error_body("PAYLOAD_TOO_LARGE", _TOO_LARGE))
            return
        messages, too_big = await _buffer_body(receive, self.max_bytes)
        if too_big:
            await _send_json(send, 413, error_body("PAYLOAD_TOO_LARGE", _TOO_LARGE))
            return
        await self.app(scope, _replay(messages), send)


def _content_length(scope) -> int | None:
    for name, value in scope.get("headers") or []:
        if name.lower() == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def _buffer_body(receive, max_bytes: int):
    messages = []
    total = 0
    while True:
        message = await receive()
        if message["type"] != "http.request":
            messages.append(message)
            if not message.get("more_body", False):
                break
            continue
        body = message.get("body") or b""
        total += len(body)
        if total > max_bytes:
            return messages, True
        messages.append(message)
        if not message.get("more_body", False):
            break
    return messages, False


def _replay(messages):
    index = 0

    async def receive():
        nonlocal index
        if index < len(messages):
            message = messages[index]
            index += 1
            return message
        return {"type": "http.request", "body": b"", "more_body": False}

    return receive


async def _send_json(send, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body, "more_body": False})

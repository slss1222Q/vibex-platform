"""
FlixCoin backend.

FastAPI + async SQLite/PostgreSQL-ready architecture for a Telegram Mini App
Watch-to-Earn video platform. This single-file version is intentionally compact
for GitHub/demo onboarding, but it keeps production boundaries clear.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator

try:
    from passlib.context import CryptContext
except Exception as exc:  
    raise RuntimeError("Install backend requirements: pip install fastapi uvicorn passlib[bcrypt] aiosqlite") from exc

try:
    import aiosqlite
except Exception as exc:  
    raise RuntimeError("Install backend requirements: pip install aiosqlite") from exc


APP_NAME = "FlixCoin"
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./flixcoin.db")
JWT_SECRET = os.getenv("FLIXCOIN_SECRET", "dev-change-this-secret-before-production")
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "168"))
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173")
SUPERADMIN_USERNAME = os.getenv("FLIXCOIN_SUPERADMIN_USERNAME", "admin")
SUPERADMIN_PASSWORD = os.getenv("FLIXCOIN_SUPERADMIN_PASSWORD", "Admin12345!")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("flixcoin")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso_now() -> str:
    return utcnow().isoformat()


def db_path_from_url(url: str) -> str:
    if url.startswith("sqlite+aiosqlite:///"):
        return url.replace("sqlite+aiosqlite:///", "", 1)
    if url.startswith("sqlite:///"):
        return url.replace("sqlite:///", "", 1)
    raise RuntimeError("This single-file demo supports SQLite. Use SQLAlchemy async for PostgreSQL deployment.")


DB_PATH = db_path_from_url(DATABASE_URL)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_\.]+$")
    password: str = Field(min_length=8, max_length=128)
    fingerprint_hash: str = Field(min_length=16, max_length=128)


class LoginRequest(BaseModel):
    full_username: str = Field(min_length=4, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    fingerprint_hash: str = Field(min_length=16, max_length=128)


class AuthResponse(BaseModel):
    token: str
    user: dict[str, Any]


class VideoCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=40)
    video_url: str = Field(min_length=12, max_length=2048)

    @field_validator("video_url")
    @classmethod
    def validate_video_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https":
            raise ValueError("Only HTTPS video URLs are allowed")
        if not parsed.netloc:
            raise ValueError("Invalid video host")
        clean_path = parsed.path.lower()
        if not clean_path.endswith((".mp4", ".webm", ".mov", ".m4v")):
            raise ValueError("URL must point to a direct video file")
        return value


class InteractionRequest(BaseModel):
    target_user_id: int | None = None
    fingerprint_hash: str = Field(min_length=16, max_length=128)


class WatchEventRequest(BaseModel):
    video_id: int
    seconds_watched: float = Field(ge=0, le=600)
    completed: bool
    fingerprint_hash: str = Field(min_length=16, max_length=128)


class AdminUserPatch(BaseModel):
    coins: Decimal | None = Field(default=None, ge=0, le=1_000_000)
    follower_count: int | None = Field(default=None, ge=0, le=100_000_000)
    like_count: int | None = Field(default=None, ge=0, le=100_000_000)
    is_uploader: bool | None = None
    is_superadmin: bool | None = None
    is_banned: bool | None = None


class BanAppealRequest(BaseModel):
    message: str = Field(min_length=10, max_length=1000)
    fingerprint_hash: str = Field(min_length=16, max_length=128)


class ConnectionManager:
    def __init__(self) -> None:
        self.active: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.active.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self.active.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        async with self._lock:
            clients = list(self.active)
        for websocket in clients:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        if stale:
            async with self._lock:
                for websocket in stale:
                    self.active.discard(websocket)


manager = ConnectionManager()


# Render xatoligini to'g'rilash uchun db context'ni xavfsiz qilish
async def db() -> aiosqlite.Connection:
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    await conn.execute("PRAGMA foreign_keys = ON")
    await conn.execute("PRAGMA journal_mode = WAL")
    return conn


def sign_token(user_id: int, full_username: str, is_superadmin: bool) -> str:
    expires = int((utcnow() + timedelta(hours=TOKEN_TTL_HOURS)).timestamp())
    nonce = secrets.token_urlsafe(12)
    payload = f"{user_id}.{full_username}.{int(is_superadmin)}.{expires}.{nonce}"
    signature = hmac.new(JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def verify_token(token: str) -> dict[str, Any]:
    try:
        user_id, full_username, is_superadmin, expires, nonce, signature = token.split(".", 5)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    payload = f"{user_id}.{full_username}.{is_superadmin}.{expires}.{nonce}"
    expected = hmac.new(JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if int(expires) < int(utcnow().timestamp()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Expired token")
    return {
        "id": int(user_id),
        "full_username": full_username,
        "is_superadmin": bool(int(is_superadmin)),
    }


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token_data = verify_token(credentials.credentials)
    async with await db() as conn:
        row = await fetch_one(conn, "SELECT * FROM users WHERE id = ?", (token_data["id"],))
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    user = dict(row)
    if user["is_banned"]:
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account banned")
    return user


def require_uploader(user: dict[str, Any]) -> None:
    if not (user["is_uploader"] or user["is_superadmin"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved uploaders or superadmins can publish video links",
        )


def require_superadmin(user: dict[str, Any]) -> None:
    if not user["is_superadmin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SuperAdmin only")


async def fetch_one(conn: aiosqlite.Connection, query: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    async with conn.execute(query, params) as cursor:
        return await cursor.fetchone()


async def fetch_all(conn: aiosqlite.Connection, query: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    async with conn.execute(query, params) as cursor:
        return await cursor.fetchall()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def generate_full_username(username: str) -> str:
    prefixes = "%*&$#@"
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return f"{username.lower()}{secrets.choice(prefixes)}{secrets.choice(alphabet + '0123456789')}"


async def create_unique_full_username(conn: aiosqlite.Connection, username: str) -> str:
    for _ in range(20):
        full_username = generate_full_username(username)
        exists = await fetch_one(conn, "SELECT id FROM users WHERE full_username = ?", (full_username,))
        if exists is None:
            return full_username
    raise HTTPException(status_code=500, detail="Could not allocate username")


async def log_security_event(
    conn: aiosqlite.Connection,
    *,
    user_id: int | None,
    ip_address: str,
    fingerprint_hash: str,
    event_type: str,
    severity: int,
    metadata: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO security_events(user_id, ip_address, fingerprint_hash, event_type, severity, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, ip_address, fingerprint_hash, event_type, severity, metadata, iso_now()),
    )
    logger.warning(
        "security_event user_id=%s ip=%s fp=%s type=%s severity=%s metadata=%s",
        user_id,
        ip_address,
        fingerprint_hash[:12],
        event_type,
        severity,
        metadata,
    )


async def apply_strike(
    conn: aiosqlite.Connection,
    *,
    user_id: int,
    ip_address: str,
    fingerprint_hash: str,
    reason: str,
) -> int:
    existing = await fetch_one(
        conn,
        """
        SELECT id, strike_count FROM abuse_profiles
        WHERE ip_address = ? OR fingerprint_hash = ?
        ORDER BY strike_count DESC
        LIMIT 1
        """,
        (ip_address, fingerprint_hash),
    )
    strike_count = 1 if existing is None else int(existing["strike_count"]) + 1
    monetization_frozen_until = None
    locked = False

    if strike_count == 1:
        await conn.execute("UPDATE users SET coins = MAX(coins - 2, 0) WHERE id = ?", (user_id,))
    elif strike_count == 2:
        monetization_frozen_until = (utcnow() + timedelta(hours=24)).isoformat()
        await conn.execute(
            "UPDATE users SET monetization_frozen_until = ? WHERE id = ?",
            (monetization_frozen_until, user_id),
        )
    else:
        locked = True
        await conn.execute("UPDATE users SET is_banned = 1 WHERE id = ?", (user_id,))

    if existing is None:
        await conn.execute(
            """
            INSERT INTO abuse_profiles(ip_address, fingerprint_hash, strike_count, locked, monetization_frozen_until, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (ip_address, fingerprint_hash, strike_count, int(locked), monetization_frozen_until, iso_now()),
        )
    else:
        await conn.execute(
            """
            UPDATE abuse_profiles
            SET strike_count = ?, locked = ?, monetization_frozen_until = ?, updated_at = ?
            WHERE id = ?
            """,
            (strike_count, int(locked), monetization_frozen_until, iso_now(), existing["id"]),
        )

    await log_security_event(
        conn,
        user_id=user_id,
        ip_address=ip_address,
        fingerprint_hash=fingerprint_hash,
        event_type="anti_cheat_strike",
        severity=min(100, 35 * strike_count),
        metadata=f"{reason}; strike={strike_count}",
    )
    await conn.commit()
    return strike_count


async def anti_cheat_gate(
    conn: aiosqlite.Connection,
    *,
    user: dict[str, Any],
    ip_address: str,
    fingerprint_hash: str,
    action: str,
    target_user_id: int | None = None,
) -> None:
    locked = await fetch_one(
        conn,
        "SELECT * FROM abuse_profiles WHERE locked = 1 AND (ip_address = ? OR fingerprint_hash = ?)",
        (ip_address, fingerprint_hash),
    )
    if locked:
        await conn.execute("UPDATE users SET is_banned = 1 WHERE id = ?", (user["id"],))
        await conn.commit()
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Hardware fingerprint locked")

    if target_user_id and target_user_id == user["id"]:
        strike = await apply_strike(
            conn,
            user_id=user["id"],
            ip_address=ip_address,
            fingerprint_hash=fingerprint_hash,
            reason=f"self_{action}",
        )
        raise HTTPException(status_code=429, detail=f"Self engagement blocked. Strike {strike}")

    one_minute_ago = (utcnow() - timedelta(minutes=1)).isoformat()
    recent_count = await fetch_one(
        conn,
        """
        SELECT COUNT(*) AS total FROM economy_events
        WHERE ip_address = ? AND created_at > ?
        """,
        (ip_address, one_minute_ago),
    )
    if int(recent_count["total"]) >= 24:
        strike = await apply_strike(
            conn,
            user_id=user["id"],
            ip_address=ip_address,
            fingerprint_hash=fingerprint_hash,
            reason=f"fast_automated_{action}",
        )
        raise HTTPException(status_code=429, detail=f"Automated activity blocked. Strike {strike}")


def public_user(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    return {
        "id": item["id"],
        "username": item["username"],
        "full_username": item["full_username"],
        "coins": float(item["coins"]),
        "follower_count": item["follower_count"],
        "like_count": item["like_count"],
        "is_uploader": bool(item["is_uploader"]),
        "is_superadmin": bool(item["is_superadmin"]),
        "is_banned": bool(item["is_banned"]),
        "monetization_frozen_until": item["monetization_frozen_until"],
        "created_at": item["created_at"],
    }


def public_video(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    return {
        "id": item["id"],
        "title": item["title"],
        "category": item["category"],
        "video_url": item["video_url"],
        "creator_id": item["creator_id"],
        "creator_full_username": item["creator_full_username"],
        "like_count": item["like_count"],
        "comment_count": item["comment_count"],
        "created_at": item["created_at"],
    }


async def init_db() -> None:
    async with await db() as conn:
        await conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                full_username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                coins NUMERIC NOT NULL DEFAULT 0,
                follower_count INTEGER NOT NULL DEFAULT 0,
                like_count INTEGER NOT NULL DEFAULT 0,
                is_uploader INTEGER NOT NULL DEFAULT 0,
                is_superadmin INTEGER NOT NULL DEFAULT 0,
                is_banned INTEGER NOT NULL DEFAULT 0,
                monetization_frozen_until TEXT,
                created_ip TEXT NOT NULL,
                fingerprint_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                video_url TEXT NOT NULL,
                creator_id INTEGER NOT NULL REFERENCES users(id),
                creator_full_username TEXT NOT NULL,
                like_count INTEGER NOT NULL DEFAULT 0,
                comment_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS follows (
                follower_id INTEGER NOT NULL REFERENCES users(id),
                following_id INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL,
                PRIMARY KEY (follower_id, following_id)
            );

            CREATE TABLE IF NOT EXISTS video_likes (
                user_id INTEGER NOT NULL REFERENCES users(id),
                video_id INTEGER NOT NULL REFERENCES videos(id),
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, video_id)
            );

            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                video_id INTEGER NOT NULL REFERENCES videos(id),
                body TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS economy_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                action TEXT NOT NULL,
                amount NUMERIC NOT NULL,
                video_id INTEGER,
                target_user_id INTEGER,
                ip_address TEXT NOT NULL,
                fingerprint_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS abuse_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_address TEXT NOT NULL,
                fingerprint_hash TEXT NOT NULL,
                strike_count INTEGER NOT NULL DEFAULT 0,
                locked INTEGER NOT NULL DEFAULT 0,
                monetization_frozen_until TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS security_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                ip_address TEXT NOT NULL,
                fingerprint_hash TEXT NOT NULL,
                event_type TEXT NOT NULL,
                severity INTEGER NOT NULL,
                metadata TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ban_appeals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                full_username TEXT,
                fingerprint_hash TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS admin_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL REFERENCES users(id),
                target_user_id INTEGER,
                action TEXT NOT NULL,
                before_json TEXT NOT NULL,
                after_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_users_full_username ON users(full_username);
            CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON users(fingerprint_hash);
            CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_events_ip_created ON economy_events(ip_address, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_abuse_lookup ON abuse_profiles(ip_address, fingerprint_hash);
            """
        )
        admin = await fetch_one(conn, "SELECT id FROM users WHERE full_username = ?", (f"{SUPERADMIN_USERNAME}#0",))
        if admin is None:
            await conn.execute(
                """
                INSERT INTO users(
                    username, full_username, password_hash, coins, follower_count, like_count,
                    is_uploader, is_superadmin, is_banned, created_ip, fingerprint_hash, created_at
                )
                VALUES (?, ?, ?, 1000, 0, 0, 1, 1, 0, ?, ?, ?)
                """,
                (
                    SUPERADMIN_USERNAME,
                    f"{SUPERADMIN_USERNAME}#0",
                    pwd_context.hash(SUPERADMIN_PASSWORD),
                    "127.0.0.1",
                    "bootstrap-superadmin-fingerprint",
                    iso_now(),
                ),
            )
        await conn.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    logger.info("%s backend initialized with database=%s", APP_NAME, DB_PATH)
    yield


app = FastAPI(title="FlixCoin API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": APP_NAME}


@app.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterRequest, request: Request) -> AuthResponse:
    ip_address = client_ip(request)
    async with await db() as conn:
        abuse = await fetch_one(
            conn,
            "SELECT locked FROM abuse_profiles WHERE locked = 1 AND (ip_address = ? OR fingerprint_hash = ?)",
            (ip_address, payload.fingerprint_hash),
        )
        if abuse:
            raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Hardware fingerprint locked")

        full_username = await create_unique_full_username(conn, payload.username)
        await conn.execute(
            """
            INSERT INTO users(username, full_username, password_hash, created_ip, fingerprint_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                payload.username.lower(),
                full_username,
                pwd_context.hash(payload.password),
                ip_address,
                payload.fingerprint_hash,
                iso_now(),
            ),
        )
        await conn.commit()
        user = await fetch_one(conn, "SELECT * FROM users WHERE full_username = ?", (full_username,))
    assert user is not None
    return AuthResponse(
        token=sign_token(user["id"], user["full_username"], bool(user["is_superadmin"])),
        user=public_user(user),
    )


@app.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest, request: Request) -> AuthResponse:
    ip_address = client_ip(request)
    async with await db() as conn:
        abuse = await fetch_one(
            conn,
            "SELECT locked FROM abuse_profiles WHERE locked = 1 AND (ip_address = ? OR fingerprint_hash = ?)",
            (ip_address, payload.fingerprint_hash),
        )
        if abuse:
            raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Hardware fingerprint locked")
        user = await fetch_one(conn, "SELECT * FROM users WHERE full_username = ?", (payload.full_username,))
        if user is None or not pwd_context.verify(payload.password, user["password_hash"]):
            await log_security_event(
                conn,
                user_id=user["id"] if user else None,
                ip_address=ip_address,
                fingerprint_hash=payload.fingerprint_hash,
                event_type="failed_login",
                severity=45,
                metadata=payload.full_username,
            )
            await conn.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        if user["is_banned"]:
            raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account banned")
    return AuthResponse(
        token=sign_token(user["id"], user["full_username"], bool(user["is_superadmin"])),
        user=public_user(user),
    )


@app.get("/me")
async def me(user: Annotated[dict[str, Any], Depends(current_user)]) -> dict[str, Any]:
    return {"user": public_user(user)}


@app.get("/videos")
async def list_videos() -> dict[str, list[dict[str, Any]]]:
    async with await db() as conn:
        rows = await fetch_all(conn, "SELECT * FROM videos ORDER BY created_at DESC LIMIT 100")
    return {"videos": [public_video(row) for row in rows]}


@app.post("/videos")
async def publish_video(
    payload: VideoCreateRequest,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    require_uploader(user)
    async with await db() as conn:
        await conn.execute(
            """
            INSERT INTO videos(title, category, video_url, creator_id, creator_full_username, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (payload.title, payload.category, payload.video_url, user["id"], user["full_username"], iso_now()),
        )
        await conn.commit()
        video = await fetch_one(conn, "SELECT * FROM videos ORDER BY id DESC LIMIT 1")
    assert video is not None
    item = public_video(video)
    await manager.broadcast({"type": "video_published", "video": item})
    return {"video": item}


@app.post("/videos/{video_id}/watch")
async def reward_watch(
    video_id: int,
    payload: WatchEventRequest,
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    if video_id != payload.video_id:
        raise HTTPException(status_code=400, detail="video_id mismatch")
    ip_address = client_ip(request)
    async with await db() as conn:
        video = await fetch_one(conn, "SELECT * FROM videos WHERE id = ?", (video_id,))
        if video is None:
            raise HTTPException(status_code=404, detail="Video not found")
        await anti_cheat_gate(
            conn,
            user=user,
            ip_address=ip_address,
            fingerprint_hash=payload.fingerprint_hash,
            action="watch",
            target_user_id=video["creator_id"],
        )
        if not payload.completed or payload.seconds_watched < 8:
            await log_security_event(
                conn,
                user_id=user["id"],
                ip_address=ip_address,
                fingerprint_hash=payload.fingerprint_hash,
                event_type="invalid_watch_reward_attempt",
                severity=35,
                metadata=f"video={video_id}; seconds={payload.seconds_watched}",
            )
            await conn.commit()
            raise HTTPException(status_code=400, detail="Watch not eligible")

        recent = await fetch_one(
            conn,
            """
            SELECT id FROM economy_events
            WHERE user_id = ? AND video_id = ? AND action = 'watch_reward'
            """,
            (user["id"], video_id),
        )
        if recent:
            return {"rewarded": False, "coins": float(user["coins"]), "reason": "already_rewarded"}

        await conn.execute("UPDATE users SET coins = coins + 2 WHERE id = ?", (user["id"],))
        await conn.execute(
            """
            INSERT INTO economy_events(user_id, action, amount, video_id, target_user_id, ip_address, fingerprint_hash, created_at)
            VALUES (?, 'watch_reward', 2, ?, ?, ?, ?, ?)
            """,
            (user["id"], video_id, video["creator_id"], ip_address, payload.fingerprint_hash, iso_now()),
        )
        await conn.commit()
        updated = await fetch_one(conn, "SELECT coins FROM users WHERE id = ?", (user["id"],))
    return {"rewarded": True, "amount": 2, "coins": float(updated["coins"])}


@app.post("/videos/{video_id}/like")
async def like_video(
    video_id: int,
    payload: InteractionRequest,
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    ip_address = client_ip(request)
    async with await db() as conn:
        video = await fetch_one(conn, "SELECT * FROM videos WHERE id = ?", (video_id,))
        if video is None:
            raise HTTPException(status_code=404, detail="Video not found")
        await anti_cheat_gate(
            conn,
            user=user,
            ip_address=ip_address,
            fingerprint_hash=payload.fingerprint_hash,
            action="like",
            target_user_id=video["creator_id"],
        )
        try:
            await conn.execute(
                "INSERT INTO video_likes(user_id, video_id, created_at) VALUES (?, ?, ?)",
                (user["id"], video_id, iso_now()),
            )
        except sqlite3.IntegrityError:
            return {"liked": False, "reason": "already_liked"}
        await conn.execute("UPDATE videos SET like_count = like_count + 1 WHERE id = ?", (video_id,))
        await conn.execute("UPDATE users SET like_count = like_count + 1, coins = coins + 0.5 WHERE id = ?", (video["creator_id"],))
        await conn.execute(
            """
            INSERT INTO economy_events(user_id, action, amount, video_id, target_user_id, ip_address, fingerprint_hash, created_at)
            VALUES (?, 'like_creator_reward', 0.5, ?, ?, ?, ?, ?)
            """,
            (user["id"], video_id, video["creator_id"], ip_address, payload.fingerprint_hash, iso_now()),
        )
        await conn.commit()
    return {"liked": True, "creator_reward": 0.5}


@app.post("/users/{target_user_id}/follow")
async def follow_user(
    target_user_id: int,
    payload: InteractionRequest,
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    ip_address = client_ip(request)
    async with await db() as conn:
        target = await fetch_one(conn, "SELECT * FROM users WHERE id = ?", (target_user_id,))
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")
        await anti_cheat_gate(
            conn,
            user=user,
            ip_address=ip_address,
            fingerprint_hash=payload.fingerprint_hash,
            action="follow",
            target_user_id=target_user_id,
        )
        try:
            await conn.execute(
                "INSERT INTO follows(follower_id, following_id, created_at) VALUES (?, ?, ?)",
                (user["id"], target_user_id, iso_now()),
            )
        except sqlite3.IntegrityError:
            return {"followed": False, "reason": "already_followed"}
        await conn.execute("UPDATE users SET follower_count = follower_count + 1, coins = coins + 1 WHERE id = ?", (target_user_id,))
        await conn.execute(
            """
            INSERT INTO economy_events(user_id, action, amount, target_user_id, ip_address, fingerprint_hash, created_at)
            VALUES (?, 'follow_creator_reward', 1, ?, ?, ?, ?)
            """,
            (user["id"], target_user_id, ip_address, payload.fingerprint_hash, iso_now()),
        )
        await conn.commit()
    return {"followed": True, "creator_reward": 1}


# ==========================================
#  YETISHMAYOTGAN ADMIN & WS ENDPOINTLARI (YAKUNLANDI)
# ==========================================

@app.patch("/admin/users/{target_user_id}")
async def admin_patch_user(
    target_user_id: int,
    payload: AdminUserPatch,
    user: Annotated[dict[str, Any], Depends(current_user)],
) -> dict[str, Any]:
    """SuperAdmin huquqiga ega bo'lgan foydalanuvchilar uchun mutatsiya amallari."""
    require_superadmin(user)
    async with await db() as conn:
        before_row = await fetch_one(conn, "SELECT * FROM users WHERE id = ?", (target_user_id,))
        if before_row is None:
            raise HTTPException(status_code=404, detail="Target user not found")
        
        before_dict = public_user(before_row)
        
        # Dinamik SQL sorovini shakllantiramiz
        updates = []
        params = []
        
        if payload.coins is not None:
            updates.append("coins = ?")
            params.append(float(payload.coins))
        if payload.follower_count is not None:
            updates.append("follower_count = ?")
            params.append(payload.follower_count)
        if payload.like_count is not None:
            updates.append("like_count = ?")
            params.append(payload.like_count)
        if payload.is_uploader is not None:
            updates.append("is_uploader = ?")
            params.append(int(payload.is_uploader))
        if payload.is_superadmin is not None:
            updates.append("is_superadmin = ?")
            params.append(int(payload.is_superadmin))
        if payload.is_banned is not None:
            updates.append("is_banned = ?")
            params.append(int(payload.is_banned))
            
        if not updates:
            return {"message": "No changes applied", "user": before_dict}
            
        params.append(target_user_id)
        query = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
        await conn.execute(query, params)
        
        # Audit log yozamiz
        after_row = await fetch_one(conn, "SELECT * FROM users WHERE id = ?", (target_user_id,))
        after_dict = public_user(after_row)
        
        await conn.execute(
            """
            INSERT INTO admin_audit_logs(admin_id, target_user_id, action, before_json, after_json, created_at)
            VALUES (?, ?, 'patch_user', ?, ?, ?)
            """,
            (user["id"], target_user_id, json.dumps(before_dict), json.dumps(after_dict), iso_now())
        )
        await conn.commit()
        
    return {"message": "User updated successfully", "user": after_dict}


@app.post("/users/appeal-ban")
async def appeal_ban(
    payload: BanAppealRequest,
    request: Request
) -> dict[str, Any]:
    """Ban bo'lgan foydalanuvchilar uchun apellyatsiya endpointi (Token talab qilinmaydi)."""
    ip_address = client_ip(request)
    async with await db() as conn:
        # Apellyatsiya berayotgan fingerprint bazada bormi?
        user = await fetch_one(conn, "SELECT id, full_username FROM users WHERE fingerprint_hash = ?", (payload.fingerprint_hash,))
        
        await conn.execute(
            """
            INSERT INTO ban_appeals(user_id, full_username, fingerprint_hash, ip_address, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user["id"] if user else None, user["full_username"] if user else "Unknown", payload.fingerprint_hash, ip_address, payload.message, iso_now())
        )
        await conn.commit()
    return {"status": "submitted", "message": "Your appeal has been received and is under review."}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Real-time xabarlar (masalan, yangi video yuklanganda push) uchun WebSocket xizmati."""
    await manager.connect(websocket)
    try:
        while True:
            # Clientdan keladigan har qanday ping/xabarlarni ushlab turish (aloqa uzilmasligi uchun)
            data = await websocket.receive_text()
            # Agar client nimadir yuborsa echo qilib qaytaramiz (ixtiyoriy)
            await websocket.send_json({"type": "pong", "data": data})
    except WebSocketDisconnect:
        await manager.disconnect(websocket)

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Iterator

from app.schemas import ChatMessage, GrowthRecord, InteractionEvent, MemoryItem, PetProfile, PetSnapshot, PetState


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self) -> None:
        configured_dir = os.getenv("MIPET_DATA_DIR")
        data_dir = Path(configured_dir) if configured_dir else Path(__file__).resolve().parents[1] / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = data_dir / "mipet.db"
        self._lock = RLock()
        self._initialize()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._lock, self.connection() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS pets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    species TEXT NOT NULL,
                    mbti TEXT NOT NULL,
                    owner_name TEXT NOT NULL,
                    owner_mbti TEXT,
                    appearance_mode TEXT NOT NULL,
                    custom_image TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS pet_states (
                    pet_id TEXT PRIMARY KEY REFERENCES pets(id) ON DELETE CASCADE,
                    hunger INTEGER NOT NULL,
                    cleanliness INTEGER NOT NULL,
                    mood INTEGER NOT NULL,
                    affection INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    level INTEGER NOT NULL DEFAULT 1,
                    xp INTEGER NOT NULL DEFAULT 0,
                    evolution_stage INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pet_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    content TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pet_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pet_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    importance REAL NOT NULL,
                    confidence REAL NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS growth_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pet_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    xp_delta INTEGER NOT NULL,
                    level INTEGER NOT NULL,
                    evolution_stage INTEGER NOT NULL,
                    detail TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_messages_pet_created ON messages(pet_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memories_pet_created ON memories(pet_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_growth_pet_created ON growth_records(pet_id, created_at DESC);
                """
            )

    def upsert_pet(self, snapshot: PetSnapshot) -> PetSnapshot:
        profile = snapshot.profile
        state = snapshot.state
        now = utc_now()
        with self._lock, self.connection() as connection:
            connection.execute(
                """
                INSERT INTO pets(id,name,species,mbti,owner_name,owner_mbti,appearance_mode,custom_image,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,species=excluded.species,mbti=excluded.mbti,
                    owner_name=excluded.owner_name,owner_mbti=excluded.owner_mbti,
                    appearance_mode=excluded.appearance_mode,custom_image=excluded.custom_image,updated_at=excluded.updated_at
                """,
                (profile.id, profile.name, profile.species, profile.mbti, profile.owner_name, profile.owner_mbti,
                 profile.appearance_mode, profile.custom_image, profile.created_at, now),
            )
            self._upsert_state(connection, profile.id, state, now)
        return snapshot

    def _upsert_state(self, connection: sqlite3.Connection, pet_id: str, state: PetState, now: str) -> None:
        connection.execute(
            """
            INSERT INTO pet_states(pet_id,hunger,cleanliness,mood,affection,action,level,xp,evolution_stage,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(pet_id) DO UPDATE SET
                hunger=excluded.hunger,cleanliness=excluded.cleanliness,mood=excluded.mood,
                affection=excluded.affection,action=excluded.action,level=excluded.level,
                xp=excluded.xp,evolution_stage=excluded.evolution_stage,updated_at=excluded.updated_at
            """,
            (pet_id, state.hunger, state.cleanliness, state.mood, state.affection, state.action,
             state.level, state.xp, state.evolution_stage, now),
        )

    def update_state(self, pet_id: str, state: PetState) -> PetState:
        with self._lock, self.connection() as connection:
            self._upsert_state(connection, pet_id, state, utc_now())
        return state

    def get_pet(self, pet_id: str) -> PetSnapshot | None:
        with self._lock, self.connection() as connection:
            row = connection.execute(
                "SELECT p.*,s.hunger,s.cleanliness,s.mood,s.affection,s.action,s.level,s.xp,s.evolution_stage "
                "FROM pets p JOIN pet_states s ON s.pet_id=p.id WHERE p.id=?",
                (pet_id,),
            ).fetchone()
        return self._snapshot_from_row(row) if row else None

    def latest_pet(self) -> PetSnapshot | None:
        with self._lock, self.connection() as connection:
            row = connection.execute(
                "SELECT p.*,s.hunger,s.cleanliness,s.mood,s.affection,s.action,s.level,s.xp,s.evolution_stage "
                "FROM pets p JOIN pet_states s ON s.pet_id=p.id ORDER BY p.updated_at DESC LIMIT 1"
            ).fetchone()
        return self._snapshot_from_row(row) if row else None

    @staticmethod
    def _snapshot_from_row(row: sqlite3.Row) -> PetSnapshot:
        profile = PetProfile(
            id=row["id"], name=row["name"], species=row["species"], mbti=row["mbti"],
            owner_name=row["owner_name"], owner_mbti=row["owner_mbti"], appearance_mode=row["appearance_mode"],
            custom_image=row["custom_image"], created_at=row["created_at"],
        )
        state = PetState(
            hunger=row["hunger"], cleanliness=row["cleanliness"], mood=row["mood"], affection=row["affection"],
            action=row["action"], level=row["level"], xp=row["xp"], evolution_stage=row["evolution_stage"],
        )
        return PetSnapshot(profile=profile, state=state)

    def record_interaction(self, pet_id: str, event: InteractionEvent) -> PetState | None:
        xp_by_event = {"chat": 2, "pet": 3, "feed": 3, "clean": 3, "walk": 2, "idle": 0}
        xp_delta = xp_by_event.get(event.type, 0)
        now = utc_now()
        with self._lock, self.connection() as connection:
            connection.execute(
                "INSERT INTO interactions(pet_id,type,content,metadata_json,created_at) VALUES(?,?,?,?,?)",
                (pet_id, event.type, event.content, json.dumps(event.metadata, ensure_ascii=False), now),
            )
            row = connection.execute("SELECT * FROM pet_states WHERE pet_id=?", (pet_id,)).fetchone()
            if not row:
                return None
            xp = row["xp"] + xp_delta
            level = 1 + xp // 50
            evolution_stage = 1 if level < 5 else 2 if level < 10 else 3
            connection.execute(
                "UPDATE pet_states SET xp=?,level=?,evolution_stage=?,updated_at=? WHERE pet_id=?",
                (xp, level, evolution_stage, now, pet_id),
            )
            connection.execute(
                "INSERT INTO growth_records(pet_id,event_type,xp_delta,level,evolution_stage,detail,created_at) VALUES(?,?,?,?,?,?,?)",
                (pet_id, event.type, xp_delta, level, evolution_stage, event.content, now),
            )
            return PetState(
                hunger=row["hunger"], cleanliness=row["cleanliness"], mood=row["mood"], affection=row["affection"],
                action=row["action"], level=level, xp=xp, evolution_stage=evolution_stage,
            )

    def add_message(self, pet_id: str, role: str, content: str) -> None:
        if not content:
            return
        with self._lock, self.connection() as connection:
            connection.execute(
                "INSERT INTO messages(pet_id,role,content,created_at) VALUES(?,?,?,?)",
                (pet_id, role, content, utc_now()),
            )

    def recent_messages(self, pet_id: str, limit: int = 30) -> list[ChatMessage]:
        with self._lock, self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM messages WHERE pet_id=? ORDER BY id DESC LIMIT ?", (pet_id, limit)
            ).fetchall()
        return [ChatMessage(id=row["id"], pet_id=row["pet_id"], role=row["role"], content=row["content"], created_at=row["created_at"]) for row in reversed(rows)]

    def add_memory(self, item: MemoryItem) -> MemoryItem:
        created_at = item.created_at or utc_now()
        with self._lock, self.connection() as connection:
            connection.execute(
                "INSERT INTO memories(pet_id,type,content,importance,confidence,created_at) VALUES(?,?,?,?,?,?)",
                (item.pet_id, item.type, item.content, item.importance, item.confidence, created_at),
            )
        return item.model_copy(update={"created_at": created_at})

    def recent_memories(self, pet_id: str, limit: int = 10) -> list[MemoryItem]:
        with self._lock, self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM memories WHERE pet_id=? ORDER BY id DESC LIMIT ?", (pet_id, limit)
            ).fetchall()
        return [MemoryItem(pet_id=row["pet_id"], type=row["type"], content=row["content"], importance=row["importance"], confidence=row["confidence"], created_at=row["created_at"]) for row in rows]

    def recent_growth(self, pet_id: str, limit: int = 30) -> list[GrowthRecord]:
        with self._lock, self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM growth_records WHERE pet_id=? ORDER BY id DESC LIMIT ?", (pet_id, limit)
            ).fetchall()
        return [GrowthRecord(id=row["id"], pet_id=row["pet_id"], event_type=row["event_type"], xp_delta=row["xp_delta"], level=row["level"], evolution_stage=row["evolution_stage"], detail=row["detail"], created_at=row["created_at"]) for row in rows]


database = Database()

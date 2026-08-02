import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Iterator

from app.schemas import (
    ChatMessage, ChatSession, GrowthRecord, InteractionEvent, MemoryItem,
    MbtiEvaluationRecord, MbtiQuestion, MbtiQuestionCreate, MbtiQuestionUpdate,
    PetProfile, PetSnapshot, PetState,
)


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
                    custom_animation_json TEXT,
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
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    pet_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '新对话',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS mbti_questions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pet_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    options_json TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS mbti_evaluations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pet_id TEXT NOT NULL,
                    trigger_type TEXT NOT NULL,
                    answers_json TEXT NOT NULL,
                    old_mbti TEXT NOT NULL,
                    suggested_mbti TEXT,
                    reasoning TEXT,
                    user_confirmed INTEGER,
                    confirmed_at TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_pet ON sessions(pet_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_pet_created ON messages(pet_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memories_pet_created ON memories(pet_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_growth_pet_created ON growth_records(pet_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_mbti_questions_pet ON mbti_questions(pet_id, sort_order);
                CREATE INDEX IF NOT EXISTS idx_mbti_eval_pet ON mbti_evaluations(pet_id, created_at DESC);
                """
            )
            self._migrate_messages_session_id(connection)
            self._ensure_column(connection, "pets", "custom_animation_json", "TEXT")

    def _migrate_messages_session_id(self, connection: sqlite3.Connection) -> None:
        columns = [row[1] for row in connection.execute("PRAGMA table_info(messages)").fetchall()]
        if "session_id" not in columns:
            connection.execute("ALTER TABLE messages ADD COLUMN session_id TEXT")
            pet_ids = [row[0] for row in connection.execute("SELECT DISTINCT pet_id FROM messages WHERE session_id IS NULL").fetchall()]
            now = utc_now()
            for pet_id in pet_ids:
                session_id = f"{pet_id}_default"
                connection.execute(
                    "INSERT OR IGNORE INTO sessions(id, pet_id, title, created_at, updated_at) VALUES(?,?,?,?,?)",
                    (session_id, pet_id, "历史对话", now, now),
                )
                connection.execute("UPDATE messages SET session_id=? WHERE pet_id=? AND session_id IS NULL", (session_id, pet_id))
        connection.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id DESC)")

    @staticmethod
    def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def upsert_pet(self, snapshot: PetSnapshot) -> PetSnapshot:
        profile = snapshot.profile
        state = snapshot.state
        now = utc_now()
        with self._lock, self.connection() as connection:
            connection.execute(
                """
                INSERT INTO pets(id,name,species,mbti,owner_name,owner_mbti,appearance_mode,custom_image,custom_animation_json,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,species=excluded.species,mbti=excluded.mbti,
                    owner_name=excluded.owner_name,owner_mbti=excluded.owner_mbti,
                    appearance_mode=excluded.appearance_mode,custom_image=excluded.custom_image,
                    custom_animation_json=excluded.custom_animation_json,updated_at=excluded.updated_at
                """,
                (profile.id, profile.name, profile.species, profile.mbti, profile.owner_name, profile.owner_mbti,
                 profile.appearance_mode, profile.custom_image,
                 json.dumps(profile.custom_animation.model_dump(by_alias=True), ensure_ascii=False) if profile.custom_animation else None,
                 profile.created_at, now),
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
            custom_image=row["custom_image"],
            custom_animation=json.loads(row["custom_animation_json"]) if row["custom_animation_json"] else None,
            created_at=row["created_at"],
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

    def add_message(self, pet_id: str, role: str, content: str, session_id: str | None = None) -> None:
        if not content:
            return
        with self._lock, self.connection() as connection:
            connection.execute(
                "INSERT INTO messages(pet_id,role,content,session_id,created_at) VALUES(?,?,?,?,?)",
                (pet_id, role, content, session_id, utc_now()),
            )
            if session_id:
                connection.execute("UPDATE sessions SET updated_at=? WHERE id=?", (utc_now(), session_id))

    def recent_messages(self, pet_id: str, limit: int = 30, session_id: str | None = None) -> list[ChatMessage]:
        with self._lock, self.connection() as connection:
            if session_id:
                rows = connection.execute(
                    "SELECT * FROM messages WHERE pet_id=? AND session_id=? ORDER BY id DESC LIMIT ?", (pet_id, session_id, limit)
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM messages WHERE pet_id=? ORDER BY id DESC LIMIT ?", (pet_id, limit)
                ).fetchall()
        return [ChatMessage(id=row["id"], pet_id=row["pet_id"], role=row["role"], content=row["content"], session_id=row["session_id"], created_at=row["created_at"]) for row in reversed(rows)]

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


    def create_session(self, pet_id: str, title: str = "新对话") -> ChatSession:
        session_id = str(uuid.uuid4())
        now = utc_now()
        with self._lock, self.connection() as connection:
            connection.execute(
                "INSERT INTO sessions(id, pet_id, title, created_at, updated_at) VALUES(?,?,?,?,?)",
                (session_id, pet_id, title, now, now),
            )
        return ChatSession(id=session_id, pet_id=pet_id, title=title, created_at=now, updated_at=now)

    def list_sessions(self, pet_id: str) -> list[ChatSession]:
        with self._lock, self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM sessions WHERE pet_id=? ORDER BY updated_at DESC", (pet_id,)
            ).fetchall()
        return [ChatSession(id=row["id"], pet_id=row["pet_id"], title=row["title"], created_at=row["created_at"], updated_at=row["updated_at"]) for row in rows]

    def delete_session(self, session_id: str) -> None:
        with self._lock, self.connection() as connection:
            connection.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
            connection.execute("DELETE FROM sessions WHERE id=?", (session_id,))

    def rename_session(self, session_id: str, title: str) -> ChatSession | None:
        now = utc_now()
        with self._lock, self.connection() as connection:
            connection.execute(
                "UPDATE sessions SET title=?, updated_at=? WHERE id=?",
                (title, now, session_id),
            )
            row = connection.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            return None
        return ChatSession(id=row["id"], pet_id=row["pet_id"], title=row["title"], created_at=row["created_at"], updated_at=row["updated_at"])

    # --- MBTI Questions CRUD ---

    def create_mbti_question(self, pet_id: str, question: MbtiQuestionCreate) -> MbtiQuestion:
        now = utc_now()
        with self._lock, self.connection() as connection:
            cursor = connection.execute(
                "INSERT INTO mbti_questions(pet_id,content,options_json,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)",
                (pet_id, question.content, json.dumps([o.model_dump() for o in question.options], ensure_ascii=False),
                 question.sort_order, now, now),
            )
            qid = cursor.lastrowid
        return MbtiQuestion(
            id=qid, pet_id=pet_id, content=question.content, options=question.options,
            sort_order=question.sort_order, is_active=True, created_at=now, updated_at=now,
        )

    def list_mbti_questions(self, pet_id: str, active_only: bool = True) -> list[MbtiQuestion]:
        with self._lock, self.connection() as connection:
            if active_only:
                rows = connection.execute(
                    "SELECT * FROM mbti_questions WHERE pet_id=? AND is_active=1 ORDER BY sort_order", (pet_id,)
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM mbti_questions WHERE pet_id=? ORDER BY sort_order", (pet_id,)
                ).fetchall()
        return [
            MbtiQuestion(
                id=row["id"], pet_id=row["pet_id"], content=row["content"],
                options=json.loads(row["options_json"]),
                sort_order=row["sort_order"], is_active=bool(row["is_active"]),
                created_at=row["created_at"], updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def update_mbti_question(self, question_id: int, update: MbtiQuestionUpdate) -> MbtiQuestion | None:
        now = utc_now()
        with self._lock, self.connection() as connection:
            row = connection.execute("SELECT * FROM mbti_questions WHERE id=?", (question_id,)).fetchone()
            if not row:
                return None
            content = update.content if update.content is not None else row["content"]
            options_json = json.dumps([o.model_dump() for o in update.options], ensure_ascii=False) if update.options is not None else row["options_json"]
            sort_order = update.sort_order if update.sort_order is not None else row["sort_order"]
            is_active = int(update.is_active) if update.is_active is not None else row["is_active"]
            connection.execute(
                "UPDATE mbti_questions SET content=?,options_json=?,sort_order=?,is_active=?,updated_at=? WHERE id=?",
                (content, options_json, sort_order, is_active, now, question_id),
            )
            return MbtiQuestion(
                id=question_id, pet_id=row["pet_id"], content=content,
                options=json.loads(options_json), sort_order=sort_order,
                is_active=bool(is_active), created_at=row["created_at"], updated_at=now,
            )

    def delete_mbti_question(self, question_id: int) -> None:
        with self._lock, self.connection() as connection:
            connection.execute("DELETE FROM mbti_questions WHERE id=?", (question_id,))

    # --- MBTI Evaluations ---

    def create_mbti_evaluation(self, pet_id: str, trigger_type: str, answers_json: str, old_mbti: str) -> int:
        now = utc_now()
        with self._lock, self.connection() as connection:
            cursor = connection.execute(
                "INSERT INTO mbti_evaluations(pet_id,trigger_type,answers_json,old_mbti,created_at) VALUES(?,?,?,?,?)",
                (pet_id, trigger_type, answers_json, old_mbti, now),
            )
            return cursor.lastrowid

    def update_mbti_evaluation_result(self, evaluation_id: int, suggested_mbti: str | None, reasoning: str) -> None:
        with self._lock, self.connection() as connection:
            connection.execute(
                "UPDATE mbti_evaluations SET suggested_mbti=?,reasoning=? WHERE id=?",
                (suggested_mbti, reasoning, evaluation_id),
            )

    def confirm_mbti_evaluation(self, evaluation_id: int, confirmed: bool) -> None:
        now = utc_now()
        with self._lock, self.connection() as connection:
            connection.execute(
                "UPDATE mbti_evaluations SET user_confirmed=?,confirmed_at=? WHERE id=?",
                (int(confirmed), now, evaluation_id),
            )

    def get_mbti_evaluation(self, evaluation_id: int) -> MbtiEvaluationRecord | None:
        with self._lock, self.connection() as connection:
            row = connection.execute("SELECT * FROM mbti_evaluations WHERE id=?", (evaluation_id,)).fetchone()
        if not row:
            return None
        return self._eval_from_row(row)

    def latest_mbti_evaluation(self, pet_id: str) -> MbtiEvaluationRecord | None:
        with self._lock, self.connection() as connection:
            row = connection.execute(
                "SELECT * FROM mbti_evaluations WHERE pet_id=? ORDER BY created_at DESC LIMIT 1", (pet_id,)
            ).fetchone()
        if not row:
            return None
        return self._eval_from_row(row)

    def list_mbti_evaluations(self, pet_id: str, limit: int = 20) -> list[MbtiEvaluationRecord]:
        with self._lock, self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM mbti_evaluations WHERE pet_id=? ORDER BY created_at DESC LIMIT ?", (pet_id, limit)
            ).fetchall()
        return [self._eval_from_row(row) for row in rows]

    @staticmethod
    def _eval_from_row(row: sqlite3.Row) -> MbtiEvaluationRecord:
        confirmed = row["user_confirmed"]
        return MbtiEvaluationRecord(
            id=row["id"], pet_id=row["pet_id"], trigger_type=row["trigger_type"],
            old_mbti=row["old_mbti"], suggested_mbti=row["suggested_mbti"],
            reasoning=row["reasoning"],
            user_confirmed=bool(confirmed) if confirmed is not None else None,
            confirmed_at=row["confirmed_at"], created_at=row["created_at"],
        )

    # --- MBTI Supporting Queries ---

    def count_interactions_since(self, pet_id: str, since: str) -> int:
        with self._lock, self.connection() as connection:
            row = connection.execute(
                "SELECT COUNT(*) as cnt FROM interactions WHERE pet_id=? AND created_at>?", (pet_id, since)
            ).fetchone()
        return row["cnt"] if row else 0

    def interaction_stats(self, pet_id: str, since_7d: str) -> dict:
        with self._lock, self.connection() as connection:
            recent_rows = connection.execute(
                "SELECT type, COUNT(*) as cnt FROM interactions WHERE pet_id=? AND created_at>? GROUP BY type",
                (pet_id, since_7d),
            ).fetchall()
            total_rows = connection.execute(
                "SELECT type, COUNT(*) as cnt FROM interactions WHERE pet_id=? GROUP BY type", (pet_id,)
            ).fetchall()
        return {
            "last_7_days": {row["type"]: row["cnt"] for row in recent_rows},
            "total": {row["type"]: row["cnt"] for row in total_rows},
        }

    def recent_user_messages(self, pet_id: str, limit: int = 20) -> list[str]:
        with self._lock, self.connection() as connection:
            rows = connection.execute(
                "SELECT content FROM messages WHERE pet_id=? AND role='user' ORDER BY id DESC LIMIT ?",
                (pet_id, limit),
            ).fetchall()
        return [row["content"] for row in reversed(rows)]

    def update_pet_mbti(self, pet_id: str, new_mbti: str) -> None:
        with self._lock, self.connection() as connection:
            connection.execute(
                "UPDATE pets SET mbti=?,updated_at=? WHERE id=?", (new_mbti, utc_now(), pet_id)
            )


database = Database()

"""Transactional local SQLite storage with optimistic revision checks."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class Conflict(ValueError):
    pass


def blank_scenario():
    return {"name": "Untitled scenario", "start": "2026-01-01", "end": "2027-12-31", "openingCash": "0.00", "discountRate": "5", "currency": "USD", "objects": []}


def demo_scenario():
    """Manually entered illustration; never added without an explicit UI action."""
    return {"name": "A year of financial breathing room", "start": "2026-01-01", "end": "2027-01-01", "openingCash": "3500.00", "discountRate": "6", "currency": "USD", "objects": [
        {"id": "demo-loan", "type": "loan", "name": "Personal loan", "start": "2026-01-01", "frequency": "monthly", "method": "principal", "principal": "12000.00", "rate": "8", "rateBasis": "nominal", "payments": 12, "firstPayment": ""},
        {"id": "demo-investment", "type": "investment", "name": "12-month term deposit", "start": "2026-01-01", "end": "2027-01-01", "amount": "10000.00", "rate": "10", "rateBasis": "effective", "frequency": "monthly", "payout": "maturity"},
        {"id": "demo-income", "type": "income", "name": "Take-home salary", "start": "2026-01-01", "end": "2026-12-31", "firstPayment": "2026-01-25", "amount": "3200.00", "frequency": "monthly", "growthMode": "annual", "growthRate": "3"},
        {"id": "demo-expense", "type": "expense", "name": "Home and living", "start": "2026-01-01", "end": "2026-12-31", "firstPayment": "2026-01-02", "amount": "2100.00", "frequency": "monthly", "growthMode": "none", "growthRate": "0"},
        {"id": "demo-custom", "type": "custom", "name": "One-off plans", "rows": [{"date": "2026-06-15", "amount": "-1800.00", "note": "Travel and annual insurance"}, {"date": "2026-12-20", "amount": "2500.00", "note": "Year-end bonus"}]}
    ]}


def clean_scenario(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("objects"), list) or len(doc["objects"]) > 200:
        raise ValueError("The scenario must contain a list of at most 200 objects.")
    if not isinstance(doc.get("name"), str) or len(doc["name"]) > 120:
        raise ValueError("A scenario name must be text of at most 120 characters.")
    clean = {key: doc.get(key, "") for key in ("name", "start", "end", "openingCash", "discountRate", "currency", "objects")}
    for key in ("start", "end", "openingCash", "discountRate", "currency"):
        if not isinstance(clean[key], str) or len(clean[key]) > 100:
            raise ValueError(f"The {key} field must be text of at most 100 characters.")
    identifiers = set()
    for obj in clean["objects"]:
        if not isinstance(obj, dict) or obj.get("type") not in ("loan", "investment", "income", "expense", "custom"):
            raise ValueError("Every object must have a supported financial type.")
        if not isinstance(obj.get("id"), str) or not obj["id"] or len(obj["id"]) > 80 or obj["id"] in identifiers:
            raise ValueError("Each object needs its own unique identifier.")
        identifiers.add(obj["id"])
        if not isinstance(obj.get("name"), str) or len(obj["name"]) > 120:
            raise ValueError("Each object needs a text name of at most 120 characters.")
        for key, value in obj.items():
            if key not in ("rows", "payments") and (not isinstance(value, str) or len(value) > 300):
                raise ValueError(f"The object's {key} field must be text of at most 300 characters.")
        if obj["type"] == "loan" and (not isinstance(obj.get("payments"), (int, str)) or isinstance(obj.get("payments"), bool)):
            raise ValueError("The number of loan payments must be a whole number or draft text.")
        if obj["type"] == "custom":
            rows = obj.get("rows")
            if not isinstance(rows, list) or len(rows) > 10000:
                raise ValueError("Custom cashflows must contain at most 10,000 rows.")
            for row in rows:
                if not isinstance(row, dict) or any(not isinstance(row.get(k, ""), str) or len(row.get(k, "")) > 300 for k in ("date", "amount", "note")):
                    raise ValueError("Each custom row must contain date, amount and note text.")
    if len(json.dumps(clean)) > 4_000_000:
        raise ValueError("This scenario is larger than the 4 MB local document limit.")
    return clean


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, document TEXT NOT NULL, revision INTEGER NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0, warnings_accepted INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL)")
            db.execute("PRAGMA user_version=1")

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def unpack(row):
        return {**json.loads(row["document"]), "id": row["id"], "revision": row["revision"], "confirmed": bool(row["confirmed"]), "warningsAccepted": bool(row["warnings_accepted"]), "updated": row["updated"]}

    def list(self):
        with self.connect() as db:
            return [self.unpack(row) for row in db.execute("SELECT * FROM scenarios ORDER BY updated DESC, id")]

    def get(self, ident):
        with self.connect() as db:
            row = db.execute("SELECT * FROM scenarios WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise KeyError("This scenario no longer exists. Return to the scenario library.")
        return self.unpack(row)

    def create(self, document):
        document = clean_scenario(document)
        ident = str(uuid4())
        with self.connect() as db:
            db.execute("INSERT INTO scenarios(id,document,revision,updated) VALUES(?,?,1,?)", (ident, json.dumps(document), datetime.now(timezone.utc).isoformat()))
        return self.get(ident)

    def save(self, ident, document, revision):
        document = clean_scenario(document)
        with self.connect() as db:
            result = db.execute("UPDATE scenarios SET document=?,revision=revision+1,confirmed=0,warnings_accepted=0,updated=? WHERE id=? AND revision=?", (json.dumps(document), datetime.now(timezone.utc).isoformat(), ident, revision))
            if result.rowcount != 1:
                raise Conflict("This scenario changed in another window. Reload it before saving so those edits are preserved.")
        return self.get(ident)

    def confirm(self, ident, revision, accepted):
        with self.connect() as db:
            result = db.execute("UPDATE scenarios SET confirmed=1,warnings_accepted=? WHERE id=? AND revision=?", (int(accepted), ident, revision))
            if result.rowcount != 1:
                raise Conflict("The inputs changed during review. Review the latest saved revision before confirming.")
        return self.get(ident)

    def delete(self, ident, revision):
        with self.connect() as db:
            result = db.execute("DELETE FROM scenarios WHERE id=? AND revision=?", (ident, revision))
            if result.rowcount != 1:
                raise Conflict("This scenario changed in another window. Reload it before deleting.")

    def import_many(self, documents):
        if not isinstance(documents, list) or len(documents) > 500:
            raise ValueError("A backup may contain at most 500 scenarios.")
        clean = [clean_scenario(doc) for doc in documents]
        with self.connect() as db:
            for doc in clean:
                db.execute("INSERT INTO scenarios(id,document,revision,updated) VALUES(?,?,1,?)", (str(uuid4()), json.dumps(doc), datetime.now(timezone.utc).isoformat()))
        return len(clean)

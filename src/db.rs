use std::path::PathBuf;

use chrono::NaiveDate;
use rusqlite::{params, Connection};

use crate::usage_history::UsageTotals;

#[derive(Debug, Clone)]
pub struct DailyRow {
    pub date: NaiveDate,
    pub model: String,
    pub project: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub turns: u64,
    pub estimated_cost_usd: f64,
}

pub fn db_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join(".claude-signal");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("usage.db")
}

pub fn open_db() -> rusqlite::Result<Connection> {
    let path = db_path();
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS daily_usage (
            date       TEXT NOT NULL,
            model      TEXT NOT NULL,
            project    TEXT NOT NULL,
            input_tokens         INTEGER NOT NULL DEFAULT 0,
            output_tokens        INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens    INTEGER NOT NULL DEFAULT 0,
            cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
            turns                INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd   REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (date, model, project)
        );

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    Ok(conn)
}

/// Upsert daily aggregates into the database.
/// Uses INSERT OR REPLACE since the primary key is (date, model, project).
pub fn store_daily_aggregates(conn: &Connection, rows: &[DailyRow]) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO daily_usage
            (date, model, project, input_tokens, output_tokens,
             cache_read_tokens, cache_creation_tokens, turns, estimated_cost_usd)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;

    for row in rows {
        stmt.execute(params![
            row.date.to_string(),
            row.model,
            row.project,
            row.input_tokens as i64,
            row.output_tokens as i64,
            row.cache_read_tokens as i64,
            row.cache_creation_tokens as i64,
            row.turns as i64,
            row.estimated_cost_usd,
        ])?;
    }
    Ok(())
}

/// Load all daily aggregates from the database, optionally filtered to dates
/// before `before_date` (exclusive). This lets us load only historical data
/// that is no longer covered by JSONL transcripts.
pub fn load_daily_aggregates(
    conn: &Connection,
    before_date: Option<NaiveDate>,
) -> rusqlite::Result<Vec<DailyRow>> {
    let (sql, date_str);
    let query_params: Vec<&dyn rusqlite::types::ToSql>;

    if let Some(date) = before_date {
        sql = "SELECT date, model, project, input_tokens, output_tokens,
                      cache_read_tokens, cache_creation_tokens, turns, estimated_cost_usd
               FROM daily_usage WHERE date < ?1 ORDER BY date";
        date_str = date.to_string();
        query_params = vec![&date_str as &dyn rusqlite::types::ToSql];
    } else {
        sql = "SELECT date, model, project, input_tokens, output_tokens,
                      cache_read_tokens, cache_creation_tokens, turns, estimated_cost_usd
               FROM daily_usage ORDER BY date";
        query_params = vec![];
    }

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(query_params.as_slice(), |row| {
        let date_str: String = row.get(0)?;
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
        Ok(DailyRow {
            date,
            model: row.get(1)?,
            project: row.get(2)?,
            input_tokens: row.get::<_, i64>(3)? as u64,
            output_tokens: row.get::<_, i64>(4)? as u64,
            cache_read_tokens: row.get::<_, i64>(5)? as u64,
            cache_creation_tokens: row.get::<_, i64>(6)? as u64,
            turns: row.get::<_, i64>(7)? as u64,
            estimated_cost_usd: row.get(8)?,
        })
    })?;

    rows.collect()
}

/// Get the earliest date present in JSONL transcripts so we know
/// which DB rows to consider "historical" (before transcript coverage).
pub fn get_meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM meta WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

/// Aggregate DailyRows into UsageTotals (summing all rows).
pub fn aggregate_rows(rows: &[DailyRow]) -> UsageTotals {
    let mut totals = UsageTotals::default();
    for row in rows {
        totals.input_tokens += row.input_tokens;
        totals.output_tokens += row.output_tokens;
        totals.cache_read_tokens += row.cache_read_tokens;
        totals.cache_creation_tokens += row.cache_creation_tokens;
        totals.turns += row.turns;
        totals.estimated_cost_usd += row.estimated_cost_usd;
    }
    totals
}

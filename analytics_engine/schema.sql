-- Read-to-Play analytics schema (ClickHouse Cloud)
-- All app data lives in ClickHouse: append-only event tables (MergeTree)
-- plus mutable state via ReplacingMergeTree. No OLTP database anywhere.

CREATE TABLE IF NOT EXISTS students
(
    student_id  UInt32,
    name        String,
    class_id    LowCardinality(String),
    grade       UInt8,
    lexile_band UInt16,
    updated_at  DateTime64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY student_id;

-- One row per completed reading session (summary grain)
CREATE TABLE IF NOT EXISTS sessions
(
    session_id       UUID,
    student_id       UInt32,
    class_id         LowCardinality(String),
    passage_id       UInt32,
    passage_title    String,
    lexile_band      UInt16,
    fk_grade         Float32,
    word_count       UInt16,
    category         LowCardinality(String),
    started_at       DateTime64(3),
    finished_at      DateTime64(3),
    total_reading_ms UInt32,
    wpm              Float32,
    comp_correct     UInt8,
    comp_total       UInt8,
    vocab_correct    UInt8,
    vocab_total      UInt8,
    completed        UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (class_id, student_id, started_at);

-- One row per chunk read (fluency grain)
CREATE TABLE IF NOT EXISTS chunk_events
(
    session_id       UUID,
    student_id       UInt32,
    class_id         LowCardinality(String),
    passage_id       UInt32,
    chunk_id         UInt8,
    chunk_word_count UInt16,
    started_at       DateTime64(3),
    finished_at      DateTime64(3),
    duration_ms      UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(finished_at)
ORDER BY (class_id, student_id, finished_at);

-- One row per question answered (comprehension/vocabulary grain)
CREATE TABLE IF NOT EXISTS question_events
(
    session_id    UUID,
    student_id    UInt32,
    class_id      LowCardinality(String),
    passage_id    UInt32,
    lexile_band   UInt16,
    question_id   LowCardinality(String),
    axis          Enum8('comprehension' = 1, 'vocabulary' = 2),
    vocab_word    LowCardinality(String),
    prompt        String,
    chosen_index  Int8,
    correct_index UInt8,
    is_correct    UInt8,
    time_spent_ms UInt32,
    answered_at   DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(answered_at)
ORDER BY (class_id, student_id, answered_at);

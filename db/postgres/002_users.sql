CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY,
  lexile_min integer NOT NULL,
  lexile_target integer NOT NULL,
  lexile_max integer NOT NULL,
  flesch_kincaid_grade double precision NOT NULL,
  dale_chall double precision NOT NULL,
  preferred_categories text[] NOT NULL DEFAULT '{}'::text[],
  preferred_topics text[] NOT NULL DEFAULT '{}'::text[],
  profile_source text NOT NULL DEFAULT 'synthetic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_user_id_valid CHECK (
    char_length(user_id) BETWEEN 1 AND 128
    AND user_id = btrim(user_id)
  ),
  CONSTRAINT users_lexile_range_valid CHECK (
    lexile_min BETWEEN 0 AND 3000
    AND lexile_target BETWEEN 0 AND 3000
    AND lexile_max BETWEEN 0 AND 3000
    AND lexile_min <= lexile_target
    AND lexile_target <= lexile_max
  ),
  CONSTRAINT users_flesch_kincaid_grade_valid CHECK (
    flesch_kincaid_grade BETWEEN -10.0 AND 50.0
  ),
  CONSTRAINT users_dale_chall_valid CHECK (
    dale_chall BETWEEN 0.0 AND 20.0
  ),
  CONSTRAINT users_preferred_categories_valid CHECK (
    cardinality(preferred_categories) <= 2
    AND preferred_categories <@ ARRAY['Lit', 'Info']::text[]
  ),
  CONSTRAINT users_preferred_topics_valid CHECK (
    cardinality(preferred_topics) <= 20
  )
);

-- CLEAR-calibrated synthetic profiles matching targets, not observed student scores.
INSERT INTO users (
  user_id,
  lexile_min,
  lexile_target,
  lexile_max,
  flesch_kincaid_grade,
  dale_chall,
  preferred_categories,
  preferred_topics,
  profile_source
)
VALUES
  ('user_demo_001', 200, 300, 400, 1.0, 5.2, ARRAY['Lit'], ARRAY['animals', 'friendship'], 'synthetic'),
  ('user_demo_002', 200, 300, 400, 2.0, 6.0, ARRAY['Lit'], ARRAY['family', 'adventure'], 'synthetic'),
  ('user_demo_003', 400, 500, 600, 2.2, 6.2, ARRAY['Lit'], ARRAY['folktales', 'kindness'], 'synthetic'),
  ('user_demo_004', 400, 500, 600, 3.6, 5.2, ARRAY['Lit'], ARRAY['mystery', 'friendship'], 'synthetic'),
  ('user_demo_005', 400, 500, 600, 2.9, 5.8, ARRAY['Info'], ARRAY['animals', 'nature'], 'synthetic'),
  ('user_demo_006', 400, 500, 600, 3.9, 6.4, ARRAY['Info'], ARRAY['space', 'science'], 'synthetic'),
  ('user_demo_007', 600, 700, 800, 4.2, 7.2, ARRAY['Lit'], ARRAY['adventure', 'mythology'], 'synthetic'),
  ('user_demo_008', 600, 700, 800, 5.2, 5.9, ARRAY['Lit'], ARRAY['historical fiction', 'mystery'], 'synthetic'),
  ('user_demo_009', 600, 700, 800, 5.0, 7.1, ARRAY['Info'], ARRAY['history', 'technology'], 'synthetic'),
  ('user_demo_010', 800, 900, 1000, 5.6, 7.8, ARRAY['Info'], ARRAY['environment', 'engineering'], 'synthetic')
ON CONFLICT (user_id) DO NOTHING;

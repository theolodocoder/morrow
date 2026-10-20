-- Habit badges (P-055, P-059): showing up to write, and answering a weekly prompt.
INSERT INTO "achievements" ("code", "name", "description", "sort_order") VALUES
  ('steady_hand', 'The Steady Hand', 'Wrote on seven days in a row.', 90),
  ('prompt_answerer', 'Answered the Call', 'Published a piece for a weekly prompt.', 100)
ON CONFLICT ("code") DO NOTHING;

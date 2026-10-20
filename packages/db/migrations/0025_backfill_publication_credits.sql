-- Credits for publications that were live before credits were stored at publish time. Same rule as
-- chapterCredits (apps/api/src/credits.ts), cut off at each row's published_at: members with >= 20 recorded
-- edits to the chapter are co-writers; accepted-proposal authors are contributors unless already co-writers;
-- the owner is never listed. Only rows still holding the empty default are touched, so re-running is a no-op.
UPDATE "publications" AS p
SET "credits" = coalesce((
  WITH cowriters AS (
    SELECT s."user_id"
    FROM "edit_sessions" s
    WHERE s."work_id" = p."work_id"
      AND s."document_id" = ch."document_id"
      AND s."started_at" < p."published_at"
      AND s."user_id" <> w."owner_id"
    GROUP BY s."user_id"
    HAVING sum(s."update_count") >= 20
  )
  SELECT jsonb_agg(jsonb_build_object('userId', x."user_id", 'role', x."role"))
  FROM (
    SELECT "user_id", 'cowriter' AS "role" FROM cowriters
    UNION ALL
    SELECT DISTINCT pr."author_id", 'contributor'
    FROM "proposals" pr
    WHERE pr."work_id" = p."work_id"
      AND pr."chapter_id" = p."chapter_id"
      AND pr."status" = 'accepted'
      AND pr."decided_at" < p."published_at"
      AND pr."author_id" <> w."owner_id"
      AND pr."author_id" NOT IN (SELECT "user_id" FROM cowriters)
  ) x
), '[]'::jsonb)
FROM "chapters" ch, "works" w
WHERE ch."id" = p."chapter_id"
  AND w."id" = p."work_id"
  AND p."superseded_at" IS NULL
  AND p."credits" = '[]'::jsonb;

CREATE INDEX "Document_search_idx" ON "Document" USING GIN (to_tsvector('simple', "title" || ' ' || "content"));

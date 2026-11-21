-- 消したページの番号。本文は持たない。同じ番号を 2 度使わない（古い URL が別のページを指さない）ためと、
-- 消したページの URL に 410 を返すため。
create table removed(
  project    text not null,
  key        text not null,
  kind       text not null,
  n          integer not null,
  removed_at text not null,      -- UTC の ISO の時刻
  primary key(project, key, kind, n)
) strict;

create table pages(
  id         integer primary key,
  project    text not null,      -- 状態の folder の名（URL の 1 段目）
  key        text not null,      -- 課題の鍵
  kind       text not null,      -- brief・confirm・proposal・plan・result・issue …（名の一覧は cli が持つ）
  n          integer not null,   -- 種類ごとの番号
  title      text not null,      -- <title> から取る
  role       text not null,      -- 置いた担当の役割（わからなければ unknown）
  workspace  text not null,      -- 置いた担当の workspace の ID（わからなければ空）
  created_at text not null,      -- UTC の ISO の時刻
  body       blob not null,      -- 置かれた HTML をそのまま
  unique(project, key, kind, n)
) strict;
create index pages_created on pages(created_at);
-- rowid は pages.id。3 字ずつの索引なので日本語にも効く。
create virtual table pages_fts using fts5(title, text, tokenize='trigram');

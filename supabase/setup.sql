-- AI 본사 설치 SQL (한 번만 실행)
-- Supabase → SQL Editor → New query → 이 파일 전체를 붙여 넣고 → Run.
-- 여러 번 실행해도 안전합니다.
--
-- 만들어지는 표는 외부(anon/authenticated)에서 접근할 수 없고,
-- 서버(Cloudflare Worker)만 secret key 로 읽고 씁니다.

create extension if not exists pgcrypto;

-- 부서: 이름·사명·목표. 목표는 대시보드에서 CEO 가 직접 고친다.
create table if not exists departments (
  id          text primary key,
  name        text not null,
  emoji       text not null,
  mission     text not null,
  goals       text not null default '',
  sort        int  not null default 0,
  job         text,   -- 직무 설명(부서가 따르는 업무 방식). 비어 있으면 기본 직무를 쓴다.
  updated_at  timestamptz not null default now()
);

-- 업무 카드: CEO 지시 한 건 = 카드 한 장. 비서실이 여러 부서로 나누면
-- 부모(parent_id) 아래 자식 카드가 생긴다.
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  department   text not null references departments(id),
  title        text not null,
  instruction  text not null,
  status       text not null default 'queued'
               check (status in ('queued', 'working', 'done', 'failed', 'cancelled')),
  source       text not null default 'ceo_web'
               check (source in ('ceo_web', 'ceo_telegram', 'agent', 'schedule')),
  parent_id    uuid references tasks(id) on delete set null,
  summary      text,
  result_md    text,
  error        text,
  attempts     int  not null default 0,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists tasks_status_created_idx on tasks (status, created_at);
create index if not exists tasks_department_created_idx on tasks (department, created_at desc);
create index if not exists tasks_parent_idx on tasks (parent_id);

-- 업무 진행 기록 (누가 언제 무엇을 했는지).
create table if not exists task_events (
  id       bigint generated always as identity primary key,
  task_id  uuid not null references tasks(id) on delete cascade,
  at       timestamptz not null default now(),
  kind     text not null,
  message  text not null
);
create index if not exists task_events_task_idx on task_events (task_id, at);

-- 무료 LLM 하루 사용량. 한도에 닿으면 에이전트는 멈추고 보고만 한다.
create table if not exists brain_usage (
  day       date not null,
  provider  text not null,
  calls     int  not null default 0,
  primary key (day, provider)
);

-- 대기 중인 카드 하나를 원자적으로 집는다. 동시에 두 번 실행돼도
-- 같은 카드를 두 에이전트가 잡지 않는다(SKIP LOCKED).
create or replace function claim_next_task() returns setof tasks
language sql as $$
  update tasks set status = 'working', started_at = now(), attempts = attempts + 1
  where id = (
    select id from tasks where status = 'queued'
    order by created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

-- 한도 안이면 사용량을 1 올리고 true, 넘으면 아무것도 안 하고 false.
create or replace function use_brain_call(p_provider text, p_limit int) returns boolean
language plpgsql as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_calls int;
begin
  insert into brain_usage (day, provider, calls) values (v_day, p_provider, 0)
  on conflict (day, provider) do nothing;
  update brain_usage set calls = calls + 1
  where day = v_day and provider = p_provider and calls < p_limit
  returning calls into v_calls;
  return v_calls is not null;
end;
$$;

-- 실행 중 서버가 죽어 'working' 에 멈춘 카드를 되살린다(3번까지 재시도).
create or replace function requeue_stuck_tasks() returns int
language plpgsql as $$
declare v_count int;
begin
  update tasks set status = case when attempts >= 3 then 'failed' else 'queued' end,
                   error  = case when attempts >= 3 then '3회 시도 후에도 끝나지 않아 중단함' else error end,
                   finished_at = case when attempts >= 3 then now() else finished_at end
  where status = 'working' and started_at < now() - interval '15 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 서버 전용 권한 (외부 역할에는 주지 않는다).
grant usage on schema public to service_role;
grant select, insert, update, delete on departments, tasks, task_events, brain_usage to service_role;
grant execute on function claim_next_task(), use_brain_call(text, int), requeue_stuck_tasks() to service_role;
revoke execute on function claim_next_task(), use_brain_call(text, int), requeue_stuck_tasks() from anon, authenticated, public;

create extension if not exists vector;

-- 회사 비전·전략 (한 행). 모든 부서가 모든 업무에서 참고한다.
create table if not exists company_profile (
  id          int primary key default 1 check (id = 1),
  vision      text not null,
  strategy    text not null default '',
  updated_at  timestamptz not null default now()
);
insert into company_profile (id, vision, strategy) values (1,
'(설치 화면에서 입력합니다)', '')
on conflict (id) do nothing;

-- 회사의 기억. 부서가 배운 점, 확인된 사실, CEO 의 결정과 피드백.
-- department 가 null 이면 전사 공통 지식이다.
create table if not exists knowledge (
  id           uuid primary key default gen_random_uuid(),
  department   text references departments(id),
  kind         text not null check (kind in ('lesson', 'fact', 'decision', 'feedback')),
  content      text not null,
  source_task  uuid references tasks(id) on delete set null,
  weight       int not null default 1,
  embedding    vector(1024),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists knowledge_department_idx on knowledge (department, active);
create index if not exists knowledge_embedding_idx on knowledge using hnsw (embedding vector_cosine_ops);

-- 의미가 가까운 기억부터 꺼낸다(해당 부서 + 전사 공통).
create or replace function match_knowledge(p_embedding vector(1024), p_department text, p_limit int)
returns table (id uuid, department text, kind text, content text, weight int, similarity float)
language sql stable as $$
  select k.id, k.department, k.kind, k.content, k.weight, 1 - (k.embedding <=> p_embedding) as similarity
  from knowledge k
  where k.active and k.embedding is not null
    and (k.department is null or p_department is null or k.department = p_department)
  order by k.embedding <=> p_embedding
  limit p_limit;
$$;

-- 부서의 자율 제안 = 결재 문서. 승인되면 업무 카드가 된다.
create table if not exists proposals (
  id                 uuid primary key default gen_random_uuid(),
  department         text not null references departments(id),
  title              text not null,
  problem            text not null,
  proposal           text not null,
  impact             text not null default '',
  effort             text not null default '',
  status             text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'held')),
  embedding          vector(1024),
  telegram_message_id bigint,
  task_id            uuid references tasks(id) on delete set null,
  ceo_note           text,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz
);
create index if not exists proposals_status_idx on proposals (status, created_at desc);

-- 이미 제안했거나 결정된 것과 너무 비슷한 제안을 찾는다(중복 제안 방지).
create or replace function similar_proposals(p_embedding vector(1024), p_limit int)
returns table (id uuid, title text, status text, similarity float)
language sql stable as $$
  select p.id, p.title, p.status, 1 - (p.embedding <=> p_embedding) as similarity
  from proposals p
  where p.embedding is not null
  order by p.embedding <=> p_embedding
  limit p_limit;
$$;

-- 업무 종류: 일반 업무 / 자율 점검(제안 만들기)
alter table tasks add column if not exists kind text not null default 'work'
  check (kind in ('work', 'initiative'));

grant select, insert, update, delete on company_profile, knowledge, proposals to service_role;
grant execute on function match_knowledge(vector, text, int), similar_proposals(vector, int) to service_role;
revoke execute on function match_knowledge(vector, text, int), similar_proposals(vector, int) from anon, authenticated, public;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists heartbeat (
  id          int primary key default 1 check (id = 1),
  at          timestamptz not null default now(),
  alerted_at  timestamptz,
  audit_at    timestamptz
);
insert into heartbeat (id) values (1) on conflict (id) do nothing;

-- 본사가 5분마다 호출. 경보가 나갔던 상태였다면 true(= 복구됨)를 돌려준다.
create or replace function beat() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_was_alerted boolean;
begin
  select alerted_at is not null into v_was_alerted from heartbeat where id = 1;
  update heartbeat set at = now(), alerted_at = null where id = 1;
  return coalesce(v_was_alerted, false);
end;
$$;

-- 감사실 본사 점검을 한 시간에 한 번만 하도록 자리를 잡는다.
create or replace function claim_hq_audit() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update heartbeat set audit_at = now()
  where id = 1 and (audit_at is null or audit_at < now() - interval '55 minutes');
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- 본사가 봇 토큰과 채팅 ID 를 Vault 에 넣어 둔다(평문 표에는 저장하지 않는다).
create or replace function set_watchdog_telegram(p_token text, p_chat text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'watchdog_telegram_token';
  if v_id is null then perform vault.create_secret(p_token, 'watchdog_telegram_token');
  else perform vault.update_secret(v_id, p_token); end if;

  select id into v_id from vault.secrets where name = 'watchdog_telegram_chat';
  if v_id is null then perform vault.create_secret(p_chat, 'watchdog_telegram_chat');
  else perform vault.update_secret(v_id, p_chat); end if;
end;
$$;

create or replace function watchdog_check() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz;
  v_alerted timestamptz;
  v_token text;
  v_chat text;
begin
  select at, alerted_at into v_at, v_alerted from heartbeat where id = 1;
  if v_at > now() - interval '30 minutes' then return; end if;
  -- 멈춘 동안에는 6시간에 한 번만 다시 알린다.
  if v_alerted is not null and v_alerted > now() - interval '6 hours' then return; end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'watchdog_telegram_token';
  select decrypted_secret into v_chat from vault.decrypted_secrets where name = 'watchdog_telegram_chat';
  if v_token is null or v_chat is null then return; end if;

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'chat_id', v_chat,
      'text', '🚨 AI 본사 심장 정지 감지' || chr(10)
        || '마지막 박동: ' || to_char(v_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' (한국시간)' || chr(10)
        || 'Cloudflare 의 배포 상태를 확인해 주세요. 복구되면 자동으로 알려드립니다.'
    )
  );
  update heartbeat set alerted_at = now() where id = 1;
end;
$$;

revoke all on function beat(), claim_hq_audit(), set_watchdog_telegram(text, text), watchdog_check() from public, anon, authenticated;
grant execute on function beat(), claim_hq_audit(), set_watchdog_telegram(text, text) to service_role;
grant select on heartbeat to service_role;

-- 10분마다 감시 (같은 이름이면 덮어쓴다)
select cron.schedule('ai-hq-watchdog', '*/10 * * * *', 'select watchdog_check()');

-- 정해진 시간에 한 번만 도는 일의 자리표.
create table if not exists schedule_slots (
  name  text primary key,
  at    timestamptz not null default now()
);
grant select, insert, update on schedule_slots to service_role;

create or replace function claim_slot(p_name text, p_minutes int) returns boolean
language plpgsql as $$
declare v_count int;
begin
  insert into schedule_slots (name, at) values (p_name, now() - make_interval(mins => p_minutes + 1))
  on conflict (name) do nothing;
  update schedule_slots set at = now()
  where name = p_name and at < now() - make_interval(mins => p_minutes);
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
grant execute on function claim_slot(text, int) to service_role;
revoke execute on function claim_slot(text, int) from anon, authenticated, public;

-- 결재가 승인되면 실행할 조치(예약).
alter table proposals add column if not exists action jsonb;
alter table proposals add column if not exists action_result text;

-- 대시보드 로그인 기록: 같은 IP 에서 15분에 5번 틀리면 잠시 막는다. 30일 지나면 지운다.
create table if not exists login_attempts (
  id    bigserial primary key,
  ip    text not null,
  ok    boolean not null,
  at    timestamptz not null default now()
);
create index if not exists login_attempts_ip_at_idx on login_attempts (ip, at);
create index if not exists login_attempts_at_idx on login_attempts (at);
grant select, insert, delete on login_attempts to service_role;
grant usage on sequence login_attempts_id_seq to service_role;

-- 설치 화면에서 입력한 값(회사 소개, 텔레그램 연결 등). 서버만 읽고 쓴다.
create table if not exists settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);
grant select, insert, update, delete on settings to service_role;

-- 비서실은 모든 회사에 있다. 다른 부서는 설치 화면에서 고른다.
insert into departments (id, name, emoji, mission, goals, sort) values
  ('cos', '비서실', '🧭', 'CEO 의 지시를 이해하고, 알맞은 부서에 나눠 맡기고, 결과를 모아 보고한다.',
   '- CEO 지시는 받은 즉시 담당 부서에 배분한다
- 매일 저녁 전사 현황을 한 장으로 요약한다', 1)
on conflict (id) do nothing;

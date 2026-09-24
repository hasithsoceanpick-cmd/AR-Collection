-- =====================================================================
-- Cheque Collection — Supabase schema
-- Run once: Supabase dashboard → SQL Editor → New query → paste → Run.
--
-- Workflow (from the whiteboard):
--   1  Customer tells sales the cheque is ready          (outside the app)
--   2  Sales records it: customer, amount, invoice(s), map pin   → submitted
--   3  Finance assigns a driver and a date                        → assigned
--   4  Driver collects, confirms/updates the amount, photographs  → collected
--        (if the amount changed, finance and sales are notified)
--   5  Finance receives the cheques                               → received
--   6  Cheques deposited, deposit slip photographed               → deposited
--   7  Finance verifies the deposit and closes                    → closed
--   Any open job can be cancelled.  Driver can report "couldn't collect".
--
-- All status changes go through the cc_* functions below. Tables have
-- read-only RLS policies; nobody can UPDATE a collection directly.
-- =====================================================================

-- ---------- Types ----------------------------------------------------
create type public.app_role  as enum ('sales', 'driver', 'finance');
create type public.cc_status as enum
  ('submitted', 'assigned', 'collected', 'received', 'deposited', 'closed', 'cancelled');

-- ---------- People ---------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text not null default '',
  role       public.app_role,            -- null = no access until finance sets it
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every new login gets a profile. The very first user becomes finance so
-- someone can hand out roles.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)));
  if (select count(*) from public.profiles) = 1 then
    update public.profiles set role = 'finance' where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ---------- Collections ----------------------------------------------
create table public.collections (
  id               bigint generated always as identity primary key,
  -- step 2: sales
  customer_name    text not null,
  invoice_refs     text,
  expected_amount  numeric(14,2) not null check (expected_amount > 0),
  contact_person   text,
  contact_phone    text,
  location_text    text,
  lat              double precision,
  lng              double precision,
  notes            text,
  status           public.cc_status not null default 'submitted',
  created_by       uuid not null references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- step 3: finance
  driver_id        uuid references public.profiles (id),
  collection_date  date,
  instructions     text,
  assigned_at      timestamptz,
  -- step 4: driver
  collected_amount numeric(14,2),
  amount_changed   boolean not null default false,
  collection_note  text,
  collected_at     timestamptz,
  -- step 5: finance
  received_at      timestamptz,
  received_by      uuid references public.profiles (id),
  -- step 6: deposit
  deposit_date      date,
  deposit_reference text,
  deposit_slip_path text,
  deposited_at      timestamptz,
  deposited_by      uuid references public.profiles (id),
  -- step 7: finance
  closed_at        timestamptz,
  closed_by        uuid references public.profiles (id),
  close_note       text,
  -- cancellation
  cancelled_at     timestamptz,
  cancelled_by     uuid references public.profiles (id),
  cancel_reason    text,
  -- photo housekeeping (manual backup, then manual delete)
  backed_up_at     timestamptz,
  backed_up_by     uuid references public.profiles (id),
  photos_deleted_at timestamptz,
  photos_deleted_by uuid references public.profiles (id)
);
create index on public.collections (status);
create index on public.collections (driver_id);
create index on public.collections (created_by);

create table public.cheques (
  id            bigint generated always as identity primary key,
  collection_id bigint not null references public.collections (id) on delete cascade,
  cheque_no     text not null,
  bank          text,
  cheque_date   date,
  amount        numeric(14,2) not null check (amount > 0),
  photo_path    text not null,
  created_at    timestamptz not null default now()
);
create index on public.cheques (collection_id);

create table public.events (
  id            bigint generated always as identity primary key,
  collection_id bigint not null references public.collections (id) on delete cascade,
  actor         uuid references public.profiles (id),
  action        text not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index on public.events (collection_id);

create table public.notifications (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  collection_id bigint references public.collections (id) on delete cascade,
  message       text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.notifications (user_id, read_at);

create table public.backup_log (
  id             bigint generated always as identity primary key,
  done_by        uuid references public.profiles (id),
  done_at        timestamptz not null default now(),
  collection_ids bigint[] not null,
  file_count     int not null
);

-- ---------- Row Level Security (read only; writes go through functions)
grant usage on schema public to authenticated;
grant select on public.profiles, public.collections, public.cheques,
  public.events, public.notifications, public.backup_log to authenticated;

alter table public.profiles      enable row level security;
alter table public.collections   enable row level security;
alter table public.cheques       enable row level security;
alter table public.events        enable row level security;
alter table public.notifications enable row level security;
alter table public.backup_log    enable row level security;

create policy "signed-in users see names" on public.profiles
  for select to authenticated using (true);

create policy "see collections you are part of" on public.collections
  for select to authenticated using (
       public.my_role() = 'finance'
    or (public.my_role() = 'sales'  and created_by = auth.uid())
    or (public.my_role() = 'driver' and driver_id  = auth.uid())
  );

create policy "see cheques of visible collections" on public.cheques
  for select to authenticated using (
    exists (select 1 from public.collections c where c.id = collection_id));

create policy "see history of visible collections" on public.events
  for select to authenticated using (
    exists (select 1 from public.collections c where c.id = collection_id));

create policy "see your notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy "finance sees backup log" on public.backup_log
  for select to authenticated using (public.my_role() = 'finance');

-- ---------- Internal helpers -----------------------------------------
create or replace function public._ref(p_id bigint) returns text
language sql immutable as $$ select 'CC-' || lpad(p_id::text, 5, '0') $$;

create or replace function public._amt(p numeric) returns text
language sql immutable as $$ select to_char(p, 'FM999,999,999,990.00') $$;

create or replace function public._name(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = p $$;

create or replace function public._log(p_id bigint, p_action text, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.events (collection_id, actor, action, note)
  values (p_id, auth.uid(), p_action, p_note) $$;

-- Notify one person (never yourself).
create or replace function public._notify(p_user uuid, p_id bigint, p_msg text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, collection_id, message)
  select p_user, p_id, p_msg
  where p_user is not null and p_user is distinct from auth.uid() $$;

create or replace function public._notify_finance(p_id bigint, p_msg text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, collection_id, message)
  select id, p_id, p_msg from public.profiles
  where role = 'finance' and active and id is distinct from auth.uid() $$;

create or replace function public._lock(p_id bigint) returns public.collections
language plpgsql security definer set search_path = public as $$
declare c public.collections;
begin
  select * into c from public.collections where id = p_id for update;
  if not found then raise exception 'Collection not found'; end if;
  return c;
end $$;

-- ---------- Step 2: sales records the collection ----------------------
create or replace function public.cc_create(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role(); v_id bigint;
begin
  if r is null or r not in ('sales', 'finance') then
    raise exception 'Only sales or finance can record a collection';
  end if;
  if coalesce(trim(p ->> 'customer_name'), '') = '' then raise exception 'Enter the customer name'; end if;
  if coalesce((p ->> 'expected_amount')::numeric, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;

  insert into public.collections
    (customer_name, invoice_refs, expected_amount, contact_person, contact_phone,
     location_text, lat, lng, notes, created_by)
  values
    (trim(p ->> 'customer_name'), nullif(trim(p ->> 'invoice_refs'), ''),
     (p ->> 'expected_amount')::numeric,
     nullif(trim(p ->> 'contact_person'), ''), nullif(trim(p ->> 'contact_phone'), ''),
     nullif(trim(p ->> 'location_text'), ''),
     (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
     nullif(trim(p ->> 'notes'), ''), auth.uid())
  returning id into v_id;

  perform public._log(v_id, 'created');
  perform public._notify_finance(v_id, format('New collection %s: %s, LKR %s',
    public._ref(v_id), trim(p ->> 'customer_name'), public._amt((p ->> 'expected_amount')::numeric)));
  return v_id;
end $$;

create or replace function public.cc_update_request(p_id bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role(); c public.collections;
begin
  c := public._lock(p_id);
  if not ((r = 'sales' and c.created_by = auth.uid() and c.status = 'submitted')
       or (r = 'finance' and c.status in ('submitted', 'assigned'))) then
    raise exception 'This collection can no longer be edited';
  end if;
  if coalesce(trim(p ->> 'customer_name'), '') = '' then raise exception 'Enter the customer name'; end if;
  if coalesce((p ->> 'expected_amount')::numeric, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;

  update public.collections set
    customer_name   = trim(p ->> 'customer_name'),
    invoice_refs    = nullif(trim(p ->> 'invoice_refs'), ''),
    expected_amount = (p ->> 'expected_amount')::numeric,
    contact_person  = nullif(trim(p ->> 'contact_person'), ''),
    contact_phone   = nullif(trim(p ->> 'contact_phone'), ''),
    location_text   = nullif(trim(p ->> 'location_text'), ''),
    lat             = (p ->> 'lat')::double precision,
    lng             = (p ->> 'lng')::double precision,
    notes           = nullif(trim(p ->> 'notes'), ''),
    updated_at      = now()
  where id = p_id;

  perform public._log(p_id, 'edited');
  perform public._notify(c.driver_id, p_id, format('Details changed for %s (%s)', public._ref(p_id), c.customer_name));
end $$;

-- ---------- Step 3: finance assigns a driver and date ------------------
create or replace function public.cc_assign(p_id bigint, p_driver uuid, p_date date, p_instructions text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.collections;
begin
  if public.my_role() is distinct from 'finance' then raise exception 'Only finance can assign a driver'; end if;
  c := public._lock(p_id);
  if c.status not in ('submitted', 'assigned') then raise exception 'This collection can no longer be assigned'; end if;
  if not exists (select 1 from public.profiles where id = p_driver and role = 'driver' and active) then
    raise exception 'Pick an active driver';
  end if;
  if p_date is null then raise exception 'Pick a collection date'; end if;

  update public.collections set
    status = 'assigned', driver_id = p_driver, collection_date = p_date,
    instructions = nullif(trim(p_instructions), ''), assigned_at = now(), updated_at = now()
  where id = p_id;

  perform public._log(p_id, case when c.status = 'assigned' then 'reassigned' else 'assigned' end,
    format('%s on %s', public._name(p_driver), to_char(p_date, 'DD Mon YYYY')));
  perform public._notify(p_driver, p_id, format('Collect from %s on %s (%s)',
    c.customer_name, to_char(p_date, 'DD Mon'), public._ref(p_id)));
  if c.driver_id is not null and c.driver_id <> p_driver then
    perform public._notify(c.driver_id, p_id, format('%s (%s) was given to another driver', public._ref(p_id), c.customer_name));
  end if;
  perform public._notify(c.created_by, p_id, format('%s will collect from %s on %s',
    public._name(p_driver), c.customer_name, to_char(p_date, 'DD Mon')));
end $$;

-- ---------- Step 4: driver collects the cheques ------------------------
-- p_cheques: [{cheque_no, bank, cheque_date, amount, photo_path}, ...]
create or replace function public.cc_collect(p_id bigint, p_cheques jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role(); c public.collections;
        v_total numeric; v_count int; v_changed boolean; v_msg text;
begin
  c := public._lock(p_id);
  if not ((r = 'driver' and c.driver_id = auth.uid()) or r = 'finance') then
    raise exception 'Only the assigned driver can record this collection';
  end if;
  if c.status <> 'assigned' then raise exception 'This collection is not waiting to be picked up'; end if;
  if jsonb_typeof(p_cheques) is distinct from 'array' or jsonb_array_length(p_cheques) = 0 then
    raise exception 'Add at least one cheque';
  end if;

  insert into public.cheques (collection_id, cheque_no, bank, cheque_date, amount, photo_path)
  select p_id,
         coalesce(nullif(trim(x ->> 'cheque_no'), ''), '?'),
         nullif(trim(x ->> 'bank'), ''),
         nullif(x ->> 'cheque_date', '')::date,
         coalesce(nullif(x ->> 'amount', '')::numeric, 0),
         coalesce(nullif(x ->> 'photo_path', ''), '')
  from jsonb_array_elements(p_cheques) x;
  -- The inserts above are rolled back if any check below fails.

  if exists (select 1 from public.cheques where collection_id = p_id and cheque_no = '?') then
    raise exception 'Each cheque needs its cheque number';
  end if;
  if exists (select 1 from public.cheques where collection_id = p_id
             and (photo_path = '' or photo_path not like p_id::text || '/%')) then
    raise exception 'Each cheque needs a photo';
  end if;

  select sum(amount), count(*) into v_total, v_count from public.cheques where collection_id = p_id;
  v_changed := v_total <> c.expected_amount;

  update public.collections set
    status = 'collected', collected_amount = v_total, amount_changed = v_changed,
    collection_note = nullif(trim(p_note), ''), collected_at = now(), updated_at = now()
  where id = p_id;

  perform public._log(p_id, 'collected', format('%s cheque(s), LKR %s', v_count, public._amt(v_total))
    || case when v_changed then format(' (expected LKR %s)', public._amt(c.expected_amount)) else '' end);

  if v_changed then
    v_msg := format('Amount changed on %s (%s): expected LKR %s, collected LKR %s',
      public._ref(p_id), c.customer_name, public._amt(c.expected_amount), public._amt(v_total));
  else
    v_msg := format('Cheques collected from %s: LKR %s (%s)', c.customer_name, public._amt(v_total), public._ref(p_id));
  end if;
  perform public._notify_finance(p_id, v_msg);
  perform public._notify(c.created_by, p_id, v_msg);
end $$;

-- Driver couldn't collect: goes back to finance to reschedule.
create or replace function public.cc_report_problem(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role(); c public.collections;
begin
  c := public._lock(p_id);
  if not ((r = 'driver' and c.driver_id = auth.uid()) or r = 'finance') then
    raise exception 'Only the assigned driver can report this';
  end if;
  if c.status <> 'assigned' then raise exception 'This collection is not waiting to be picked up'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what happened'; end if;

  update public.collections set status = 'submitted', driver_id = null, collection_date = null,
    updated_at = now() where id = p_id;
  perform public._log(p_id, 'not collected', trim(p_note));
  perform public._notify_finance(p_id, format('Not collected: %s (%s): %s', public._ref(p_id), c.customer_name, trim(p_note)));
  perform public._notify(c.created_by, p_id, format('Not collected: %s (%s): %s', public._ref(p_id), c.customer_name, trim(p_note)));
end $$;

-- ---------- Step 5: finance receives the cheques ------------------------
create or replace function public.cc_receive(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c public.collections;
begin
  if public.my_role() is distinct from 'finance' then raise exception 'Only finance can receive cheques'; end if;
  c := public._lock(p_id);
  if c.status <> 'collected' then raise exception 'These cheques are not waiting to be received'; end if;
  update public.collections set status = 'received', received_at = now(), received_by = auth.uid(),
    updated_at = now() where id = p_id;
  perform public._log(p_id, 'received');
  perform public._notify(c.driver_id, p_id, format('Finance received the cheques for %s (%s)', public._ref(p_id), c.customer_name));
end $$;

-- ---------- Step 6: deposit and slip -----------------------------------
create or replace function public.cc_deposit(p_id bigint, p_date date, p_reference text, p_slip_path text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role(); c public.collections;
begin
  c := public._lock(p_id);
  if not ((r = 'driver' and c.driver_id = auth.uid()) or r = 'finance') then
    raise exception 'Only the driver or finance can record the deposit';
  end if;
  if c.status <> 'received' then raise exception 'This collection is not waiting for a deposit'; end if;
  if p_date is null then raise exception 'Enter the deposit date'; end if;
  if coalesce(p_slip_path, '') not like p_id::text || '/%' then raise exception 'Add a photo of the deposit slip'; end if;

  update public.collections set status = 'deposited', deposit_date = p_date,
    deposit_reference = nullif(trim(p_reference), ''), deposit_slip_path = p_slip_path,
    deposited_at = now(), deposited_by = auth.uid(), updated_at = now()
  where id = p_id;
  perform public._log(p_id, 'deposited', to_char(p_date, 'DD Mon YYYY')
    || coalesce(', ref ' || nullif(trim(p_reference), ''), ''));
  perform public._notify_finance(p_id, format('Deposit slip added for %s (%s)', public._ref(p_id), c.customer_name));
end $$;

-- Finance rejects the slip: back to "received" so it can be redone.
create or replace function public.cc_return_deposit(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.collections;
begin
  if public.my_role() is distinct from 'finance' then raise exception 'Only finance can send a deposit back'; end if;
  c := public._lock(p_id);
  if c.status <> 'deposited' then raise exception 'There is no deposit to send back'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what is wrong with the deposit'; end if;
  update public.collections set status = 'received', deposit_date = null, deposit_reference = null,
    deposit_slip_path = null, deposited_at = null, deposited_by = null, updated_at = now()
  where id = p_id;
  perform public._log(p_id, 'deposit sent back', trim(p_note));
  perform public._notify(c.deposited_by, p_id, format('Deposit for %s sent back: %s', public._ref(p_id), trim(p_note)));
end $$;

-- ---------- Step 7: finance verifies and closes -------------------------
create or replace function public.cc_close(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.collections;
begin
  if public.my_role() is distinct from 'finance' then raise exception 'Only finance can close a collection'; end if;
  c := public._lock(p_id);
  if c.status <> 'deposited' then raise exception 'Only deposited collections can be closed'; end if;
  update public.collections set status = 'closed', closed_at = now(), closed_by = auth.uid(),
    close_note = nullif(trim(p_note), ''), updated_at = now() where id = p_id;
  perform public._log(p_id, 'closed', nullif(trim(p_note), ''));
  perform public._notify(c.created_by, p_id, format('%s (%s) deposited and closed', public._ref(p_id), c.customer_name));
end $$;

-- ---------- Cancel -----------------------------------------------------
create or replace function public.cc_cancel(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role(); c public.collections; v_msg text;
begin
  c := public._lock(p_id);
  if not ((r = 'finance' and c.status not in ('closed', 'cancelled'))
       or (r = 'sales' and c.created_by = auth.uid() and c.status = 'submitted')) then
    raise exception 'This collection can no longer be cancelled';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling'; end if;
  update public.collections set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = trim(p_reason), updated_at = now() where id = p_id;
  perform public._log(p_id, 'cancelled', trim(p_reason));
  v_msg := format('%s (%s) cancelled: %s', public._ref(p_id), c.customer_name, trim(p_reason));
  perform public._notify(c.created_by, p_id, v_msg);
  perform public._notify(c.driver_id, p_id, v_msg);
  if r = 'sales' then perform public._notify_finance(p_id, v_msg); end if;
end $$;

-- ---------- Photo housekeeping (finance, manual) ------------------------
create or replace function public.cc_record_backup(p_ids bigint[], p_files int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'finance' then raise exception 'Only finance can back up photos'; end if;
  update public.collections set backed_up_at = now(), backed_up_by = auth.uid()
  where id = any (p_ids) and status in ('closed', 'cancelled');
  insert into public.backup_log (done_by, collection_ids, file_count) values (auth.uid(), p_ids, p_files);
end $$;

create or replace function public.cc_mark_photos_deleted(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.my_role() is distinct from 'finance' then raise exception 'Only finance can delete photos'; end if;
  with u as (
    update public.collections set photos_deleted_at = now(), photos_deleted_by = auth.uid()
    where id = any (p_ids) and status in ('closed', 'cancelled')
      and backed_up_at is not null and photos_deleted_at is null
    returning id),
  e as (
    insert into public.events (collection_id, actor, action)
    select id, auth.uid(), 'photos deleted' from u returning 1)
  select count(*) into n from e;
  return n;
end $$;

-- ---------- Users & notifications --------------------------------------
create or replace function public.cc_set_user(p_user uuid, p_name text, p_role public.app_role, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'finance' then raise exception 'Only finance can manage users'; end if;
  if p_user = auth.uid() and (p_role is distinct from 'finance' or not p_active) then
    raise exception 'You cannot remove your own finance access';
  end if;
  update public.profiles set full_name = coalesce(nullif(trim(p_name), ''), full_name),
    role = p_role, active = p_active where id = p_user;
end $$;

create or replace function public.cc_set_my_name(p_name text) returns void
language sql security definer set search_path = public as $$
  update public.profiles set full_name = trim(p_name)
  where id = auth.uid() and coalesce(trim(p_name), '') <> '' $$;

create or replace function public.cc_mark_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids)) $$;

-- Only signed-in users may call functions; internal helpers are hidden.
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public._log(bigint, text, text), public._notify(uuid, bigint, text),
  public._notify_finance(bigint, text), public._lock(bigint), public.handle_new_user() from authenticated;

-- ---------- Storage: private bucket for cheque and slip photos ---------
-- Files are stored as <collection id>/<name>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cheques', 'cheques', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public._file_collection(p_name text) returns bigint
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9]{1,15}$' then split_part(p_name, '/', 1)::bigint end $$;

create or replace function public.can_view_file(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.collections c
    where c.id = public._file_collection(p_name)
      and (public.my_role() = 'finance'
        or (public.my_role() = 'sales'  and c.created_by = auth.uid())
        or (public.my_role() = 'driver' and c.driver_id  = auth.uid()))) $$;

create or replace function public.can_upload_file(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.collections c
    where c.id = public._file_collection(p_name)
      and c.status in ('assigned', 'received')
      and (public.my_role() = 'finance'
        or (public.my_role() = 'driver' and c.driver_id = auth.uid()))) $$;

grant execute on function public._file_collection(text), public.can_view_file(text),
  public.can_upload_file(text) to authenticated;

create policy "cc: view photos"   on storage.objects for select to authenticated
  using (bucket_id = 'cheques' and public.can_view_file(name));
create policy "cc: upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'cheques' and public.can_upload_file(name));
create policy "cc: finance deletes photos" on storage.objects for delete to authenticated
  using (bucket_id = 'cheques' and public.my_role() = 'finance');

-- ---------- Live updates ------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.collections, public.notifications;
exception when duplicate_object or undefined_object then null;
end $$;

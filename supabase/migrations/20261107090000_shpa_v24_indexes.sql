-- v24: индексы для частых запросов (сервер маленький — каждый запрос должен быть дешёвым).
create index if not exists vote_ballots_round_player on public.vote_ballots (round, player_id);
create index if not exists vote_members_round_team on public.vote_members (round, team);
create index if not exists merch_orders_item on public.merch_orders (item_id) where status <> 'cancelled';
create index if not exists submissions_player on public.submissions (player_id, created_at desc);
analyze public.vote_ballots, public.vote_members, public.merch_orders, public.submissions, public.rating_log, public.players;

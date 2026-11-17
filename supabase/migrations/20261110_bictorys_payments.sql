alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists payment_reference text,
  add column if not exists payment_method text,
  add column if not exists merchant_fees numeric(12, 2),
  add column if not exists settled_amount numeric(12, 2);

update public.orders
set payment_provider = 'paytech'
where payment_provider is null
  and (paytech_token is not null or paytech_ref_command is not null);

create unique index if not exists orders_payment_reference_uidx
  on public.orders (payment_reference)
  where payment_reference is not null;

create or replace function public.confirm_product_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_variant_stock integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.status in (
    'payé',
    'commandé_fournisseur',
    'chez_transitaire',
    'en_transit',
    'arrivé',
    'prête_a_retirer',
    'récupéré'
  ) then
    return true;
  end if;

  if exists (select 1 from public.order_variant_lines where order_id = p_order_id) then
    if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = true then
      update public.orders set status = 'payé' where id = p_order_id;
      update public.order_variant_lines
      set stock_reserved = false, stock_committed = true
      where order_id = p_order_id;
      return true;
    end if;

    if v_order.status in ('pending_payment', 'cancelled') then
      perform 1
      from public.product_variants as variants
      join public.order_variant_lines as lines on lines.variant_id = variants.id
      where lines.order_id = p_order_id
      order by variants.id
      for update of variants;

      if exists (
        select 1
        from public.order_variant_lines as lines
        left join public.product_variants as variants on variants.id = lines.variant_id
        where lines.order_id = p_order_id
          and (variants.id is null or not variants.active
            or (variants.stock is not null and variants.stock < lines.quantity))
      ) then
        update public.orders
        set status = 'payé', variant_stock_reserved = false,
            variant_stock_committed = false, variant_reservation_expires_at = null
        where id = p_order_id;
        return true;
      end if;

      update public.product_variants as variants
      set stock = variants.stock - lines.quantity
      from public.order_variant_lines as lines
      where lines.order_id = p_order_id
        and lines.variant_id = variants.id
        and variants.stock is not null;

      update public.orders
      set status = 'payé', variant_stock_reserved = false,
          variant_stock_committed = true, variant_reservation_expires_at = null
      where id = p_order_id;
      update public.order_variant_lines
      set stock_reserved = false, stock_committed = true
      where order_id = p_order_id;
      return true;
    end if;
    return false;
  end if;

  if v_order.variant_id is null and v_order.variant_values = '{}'::jsonb then
    update public.orders set status = 'payé'
    where id = p_order_id and status in ('pending_payment', 'cancelled');
    return found;
  end if;

  if v_order.variant_id is null then return false; end if;

  if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = false then
    select stock into v_variant_stock from public.product_variants
    where id = v_order.variant_id and active = true for update;
    if not found then return false; end if;
    if v_variant_stock is null then
      update public.orders set status = 'payé', variant_stock_committed = true,
        variant_reservation_expires_at = null where id = p_order_id;
      return true;
    end if;
  end if;

  if v_order.status = 'pending_payment' and v_order.variant_stock_reserved = true then
    update public.orders set status = 'payé', variant_stock_committed = true where id = p_order_id;
    return true;
  end if;

  if v_order.status = 'cancelled' and v_order.variant_stock_reserved = false then
    select stock into v_variant_stock from public.product_variants
    where id = v_order.variant_id and active = true for update;
    if not found then return false; end if;
    if v_variant_stock is null then
      update public.orders set status = 'payé', variant_stock_committed = true,
        variant_reservation_expires_at = null where id = p_order_id;
      return true;
    end if;
    if v_variant_stock < v_order.quantity then
      update public.orders set status = 'payé', variant_stock_committed = false,
        variant_reservation_expires_at = null where id = p_order_id;
      return true;
    end if;
    update public.product_variants set stock = stock - v_order.quantity where id = v_order.variant_id;
    update public.orders set status = 'payé', variant_stock_committed = true,
      variant_reservation_expires_at = null where id = p_order_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.confirm_product_order(uuid) from public, anon, authenticated;
grant execute on function public.confirm_product_order(uuid) to service_role;

create or replace function public.confirm_paytech_product_order(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.confirm_product_order(p_order_id);
$$;

revoke all on function public.confirm_paytech_product_order(uuid) from public, anon, authenticated;
grant execute on function public.confirm_paytech_product_order(uuid) to service_role;

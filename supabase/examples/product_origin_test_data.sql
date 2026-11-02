insert into public.products (
  id, name, description, price, category, moq, stock_status, active, featured,
  origin, local_stock, city, delivery_delay, stock_updated_at
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '[TEST Jalims] Sac en cuir',
    'Produit de démonstration disponible localement.',
    12500, 'Mode', 1, 'available', true, false,
    'local', 8, 'Dakar', '24-72h', now()
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '[TEST Jalims] Écouteurs Bluetooth',
    'Produit de démonstration disponible localement.',
    8500, 'Électronique', 1, 'available', true, false,
    'local', 12, 'Thiès', '48-72h', now()
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    '[TEST Jalims] Lampe de bureau',
    'Produit de démonstration disponible localement.',
    9800, 'Maison', 1, 'available', true, false,
    'local', 5, 'Saint-Louis', '2-4 jours', now()
  ),
  (
    'a1000000-0000-4000-8000-000000000004',
    '[TEST Jalims] Montre connectée',
    'Produit de démonstration à importer de Chine.',
    22000, 'Électronique', 1, 'available', true, false,
    'import', 0, null, null, null
  ),
  (
    'a1000000-0000-4000-8000-000000000005',
    '[TEST Jalims] Organiseur de cuisine',
    'Produit de démonstration à importer de Chine.',
    6800, 'Maison', 1, 'available', true, false,
    'import', 0, null, null, null
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  category = excluded.category,
  moq = excluded.moq,
  stock_status = excluded.stock_status,
  active = excluded.active,
  featured = excluded.featured,
  origin = excluded.origin,
  local_stock = excluded.local_stock,
  city = excluded.city,
  delivery_delay = excluded.delivery_delay,
  stock_updated_at = excluded.stock_updated_at;

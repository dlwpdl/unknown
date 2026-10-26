-- Redesigned business home tiles, saved cost menus and stock steppers; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('merchant.home.tile'),('merchant.cost.menu'),('merchant.stock.step')
on conflict do nothing;

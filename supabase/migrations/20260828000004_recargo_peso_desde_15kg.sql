-- El primer recargo de peso aplica desde 15 kg inclusive.
-- Los códigos se conservan para no alterar pedidos ni integraciones existentes.
UPDATE public.recargos
SET nombre = 'Menos de 15 kg'
WHERE codigo = 'sin_peso';

UPDATE public.recargos
SET nombre = 'Desde 15 kg'
WHERE codigo = 'peso_mas_20kg';

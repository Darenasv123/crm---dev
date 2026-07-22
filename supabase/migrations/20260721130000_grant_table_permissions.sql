-- Migration: 20260721130000_grant_table_permissions.sql
-- Description: Concesión explícita de permisos de tabla en el esquema public para service_role, authenticated y anon.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon;

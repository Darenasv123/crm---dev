-- Migration: 20260721140000_revoke_anon_write_permissions.sql
-- Description: Revocación total de privilegios al rol anon en el esquema public y privilegios predeterminados.

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

alter default privileges for role postgres in schema public
revoke all privileges on tables from anon;

alter default privileges for role postgres in schema public
revoke usage, select on sequences from anon;

alter default privileges for role postgres in schema public
revoke execute on functions from anon;

alter default privileges for role postgres
revoke execute on functions from public;

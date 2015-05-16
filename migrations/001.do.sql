CREATE EXTENSION "uuid-ossp";

CREATE TABLE inventories (
    id uuid PRIMARY KEY,
    account uuid not null,
    doc json not null
);

CREATE TABLE facilities (
    id uuid PRIMARY KEY,
    account uuid not null,
    inventory_id uuid not null references inventories (id),
    blueprint uuid not null,
    current_job_id uuid,

    disabled boolean not null default false,
    has_resources boolean not null default false,
    doc json not null,

    trigger_at timestamp with time zone,
    next_backoff interval not null default '1 second'
);

CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    facility_id uuid references facilities (id),
    account uuid not null,

    trigger_at timestamp with time zone not null,
    next_backoff interval not null default '1 second',

    status varchar(255) not null,
    statusCompletedAt timestamp with time zone not null,
    createdAt timestamp with time zone not null,
    doc json not null
);

alter table facilities add foreign key (current_job_id) references jobs;

--CREATE TABLE slice_permissions (
--    id uuid PRIMARY KEY,
--    doc json not null
--);

CREATE TABLE ships (
    id uuid PRIMARY KEY,
    status varchar(255),
    container_id uuid references inventories (id),
    container_slice varchar(255),
    account uuid not null,
    doc json not null
);

CREATE EXTENSION "uuid-ossp";

CREATE TABLE containers (
    id uuid PRIMARY KEY,
    agent_id uuid not null,
    doc json not null
);

CREATE TABLE facilities (
    id uuid PRIMARY KEY,
    agent_id uuid not null,
    container_id uuid not null references containers (id) ON DELETE CASCADE,
    blueprint uuid not null,
    current_job_id uuid,

    disabled boolean not null default false,
    facility_type varchar(255) not null,
    doc json not null,

    trigger_at timestamp with time zone,
    next_backoff interval not null default '1 second'
);

CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    facility_id uuid references facilities (id) ON DELETE SET NULL,
    agent_id uuid not null,

    trigger_at timestamp with time zone not null,
    next_backoff interval not null default '1 second',

    status varchar(255) not null,
    statusCompletedAt timestamp with time zone not null,
    createdAt timestamp with time zone not null,
    doc json not null
);

alter table facilities add foreign key (current_job_id) references jobs ON DELETE SET NULL;

--CREATE TABLE slice_permissions (
--    id uuid PRIMARY KEY,
--    doc json not null
--);

CREATE TABLE items (
    id uuid PRIMARY KEY,
    blueprint_id uuid not null,
    container_id uuid references containers (id) ON DELETE CASCADE,
    container_slice varchar(255),
    locked boolean not null default false,
    agent_id uuid not null,
    doc json not null
);

CREATE TABLE blueprints (
    id uuid PRIMARY KEY,
    tech varchar(255) not null,
    is_public boolean not null default false,
    parameters json not null,
    doc json not null
);

alter table facilities add foreign key (blueprint) references blueprints (id);
alter table items add foreign key (blueprint_id) references blueprints (id);

CREATE TABLE blueprint_perms (
    blueprint_id uuid not null references blueprints (id) ON DELETE CASCADE,
    agent_id uuid not null,
    can_research boolean not null default false,
    can_manufacture boolean not null default false,
    PRIMARY KEY (blueprint_id, agent_id)
);

CREATE TABLE solar_systems (
    id uuid PRIMARY KEY,
    doc json not null
);

CREATE TABLE space_objects (
    id uuid PRIMARY KEY,
    agent_id uuid,
    system_id uuid not null REFERENCES solar_systems (id),
    tombstone boolean not null default false,
    tombstone_at timestamp,
    doc json not null
);

CREATE TABLE wormholes (
    id uuid PRIMARY KEY,
    outbound_system uuid not null REFERENCES solar_systems (id),
    outbound_id uuid,
    inbound_system uuid not null REFERENCES solar_systems (id),
    inbound_id uuid,
    expires_at timestamp not null
);

CREATE UNIQUE INDEX unique_system_pairs ON wormholes (outbound_system, inbound_system);

CREATE VIEW system_wormholes AS select solar_systems.id, count(wormholes.id)::int from solar_systems left join wormholes on ((solar_systems.id = wormholes.outbound_system OR solar_systems.id = wormholes.inbound_system) and wormholes.expires_at > current_timestamp) group by solar_systems.id;
